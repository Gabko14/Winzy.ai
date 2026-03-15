using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.AuthService.Data;
using Winzy.AuthService.Entities;
using Winzy.AuthService.Models;
using Winzy.AuthService.Services;
using Winzy.AuthService.Validation;
using Winzy.Common.Messaging;
using Winzy.Contracts;
using Winzy.Contracts.Events;

namespace Winzy.AuthService.Endpoints;

public static class AuthEndpoints
{
    private const string RefreshCookieName = "refresh_token";

    public static void MapAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/auth");

        group.MapPost("/register", Register);
        group.MapPost("/login", Login);
        group.MapPost("/refresh", Refresh);
        group.MapPost("/logout", Logout);
        group.MapGet("/profile", GetProfile);
        group.MapPut("/profile", UpdateProfile);
        group.MapPut("/password", ChangePassword);
        group.MapDelete("/account", DeleteAccount);
        group.MapGet("/export", ExportData);
        group.MapGet("/users/search", SearchUsers);
        group.MapGet("/internal/resolve/{username}", ResolveUsername);
        group.MapPost("/internal/profiles", BatchProfiles);
        group.MapGet("/internal/export/{userId:guid}", InternalExport);
    }

    private static async Task<IResult> Register(
        RegisterRequest request,
        AuthDbContext db,
        PasswordHasher hasher,
        TokenService tokens,
        NatsEventPublisher nats,
        HttpContext httpContext,
        ILogger<Program> logger,
        CancellationToken ct)
    {
        var validationErrors = RequestValidator.ValidateRegistration(
            request.Email, request.Username, request.Password);
        if (validationErrors is not null)
            return Results.ValidationProblem(validationErrors);

        var emailLower = request.Email.Trim().ToLowerInvariant();
        var usernameLower = request.Username.Trim().ToLowerInvariant();

        if (await db.Users.AnyAsync(u => u.Email == emailLower, ct))
            return Results.Conflict(new { error = "Email already registered." });

        if (await db.Users.AnyAsync(u => u.Username == usernameLower, ct))
            return Results.Conflict(new { error = "Username already taken." });

        var user = new User
        {
            Email = emailLower,
            Username = usernameLower,
            PasswordHash = hasher.Hash(request.Password),
            DisplayName = request.DisplayName?.Trim()
        };

        db.Users.Add(user);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Concurrent registration with same email/username — unique index caught it
            return Results.Conflict(new { error = "Email or username already taken." });
        }

        try
        {
            await nats.PublishAsync(Subjects.UserRegistered,
                new UserRegisteredEvent(user.Id, user.Username), ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to publish user.registered event for user {UserId}", user.Id);
        }

        var accessToken = tokens.GenerateAccessToken(user.Id, user.Email);
        var refreshToken = await CreateRefreshToken(db, tokens, user.Id, ct);

        SetRefreshCookie(httpContext, refreshToken.Token, refreshToken.ExpiresAt);

        return Results.Created($"/auth/profile", new AuthResponse(
            accessToken,
            refreshToken.Token,
            ToProfile(user)));
    }

    private static async Task<IResult> Login(
        LoginRequest request,
        AuthDbContext db,
        PasswordHasher hasher,
        TokenService tokens,
        HttpContext httpContext,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.EmailOrUsername) || string.IsNullOrWhiteSpace(request.Password))
            return Results.BadRequest(new { error = "Email/username and password are required." });

        var input = request.EmailOrUsername.Trim().ToLowerInvariant();

        var user = await db.Users.FirstOrDefaultAsync(
            u => u.Email == input || u.Username == input, ct);

        if (user is null || !hasher.Verify(request.Password, user.PasswordHash))
            return Results.Unauthorized();

        user.LastLoginAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        var accessToken = tokens.GenerateAccessToken(user.Id, user.Email);
        var refreshToken = await CreateRefreshToken(db, tokens, user.Id, ct);

        SetRefreshCookie(httpContext, refreshToken.Token, refreshToken.ExpiresAt);

        return Results.Ok(new AuthResponse(
            accessToken,
            refreshToken.Token,
            ToProfile(user)));
    }

    private static async Task<IResult> Refresh(
        RefreshRequest? request,
        AuthDbContext db,
        TokenService tokens,
        HttpContext httpContext,
        CancellationToken ct)
    {
        // Try cookie first, then request body (for native clients)
        var tokenValue = httpContext.Request.Cookies[RefreshCookieName]
            ?? request?.RefreshToken;

        if (string.IsNullOrWhiteSpace(tokenValue))
            return Results.Unauthorized();

        var existing = await db.RefreshTokens
            .Include(t => t.User)
            .FirstOrDefaultAsync(t => t.Token == tokenValue, ct);

        if (existing is null || existing.IsRevoked || existing.ExpiresAt <= DateTimeOffset.UtcNow)
            return Results.Unauthorized();

        // Rotate: revoke old, create new
        existing.RevokedAt = DateTimeOffset.UtcNow;

        var newRefreshToken = await CreateRefreshToken(db, tokens, existing.UserId, ct);
        var accessToken = tokens.GenerateAccessToken(existing.User.Id, existing.User.Email);

        SetRefreshCookie(httpContext, newRefreshToken.Token, newRefreshToken.ExpiresAt);

        return Results.Ok(new AuthResponse(
            accessToken,
            newRefreshToken.Token,
            ToProfile(existing.User)));
    }

    private static async Task<IResult> Logout(
        RefreshRequest? request,
        AuthDbContext db,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var userId = GetUserId(httpContext);
        if (userId is null)
            return Results.Unauthorized();

        // Cookie for web clients, body for native clients
        var tokenValue = httpContext.Request.Cookies[RefreshCookieName]
            ?? request?.RefreshToken;

        if (!string.IsNullOrWhiteSpace(tokenValue))
        {
            var token = await db.RefreshTokens
                .FirstOrDefaultAsync(t => t.Token == tokenValue && t.UserId == userId, ct);

            if (token is not null && !token.IsRevoked)
            {
                token.RevokedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(ct);
            }
        }

        ClearRefreshCookie(httpContext);

        return Results.NoContent();
    }

    private static async Task<IResult> GetProfile(
        AuthDbContext db,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var userId = GetUserId(httpContext);
        if (userId is null)
            return Results.Unauthorized();

        var user = await db.Users.FindAsync([userId.Value], ct);
        if (user is null)
            return Results.NotFound();

        return Results.Ok(ToProfile(user));
    }

    private static async Task<IResult> UpdateProfile(
        UpdateProfileRequest request,
        AuthDbContext db,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var userId = GetUserId(httpContext);
        if (userId is null)
            return Results.Unauthorized();

        var user = await db.Users.FindAsync([userId.Value], ct);
        if (user is null)
            return Results.NotFound();

        if (request.DisplayName is not null)
            user.DisplayName = string.IsNullOrWhiteSpace(request.DisplayName) ? null : request.DisplayName.Trim();
        if (request.AvatarUrl is not null)
        {
            var trimmedUrl = request.AvatarUrl.Trim();
            if (string.IsNullOrWhiteSpace(trimmedUrl))
            {
                user.AvatarUrl = null;
            }
            else if (Uri.TryCreate(trimmedUrl, UriKind.Absolute, out var uri)
                     && (uri.Scheme == "https" || uri.Scheme == "http"))
            {
                user.AvatarUrl = trimmedUrl;
            }
            else
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["avatarUrl"] = ["AvatarUrl must be a valid HTTP(S) URL."]
                });
            }
        }

        await db.SaveChangesAsync(ct);

        return Results.Ok(ToProfile(user));
    }

    private static async Task<IResult> ChangePassword(
        ChangePasswordRequest request,
        AuthDbContext db,
        PasswordHasher hasher,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var userId = GetUserId(httpContext);
        if (userId is null)
            return Results.Unauthorized();

        var passwordErrors = RequestValidator.ValidateChangePassword(request.NewPassword);
        if (passwordErrors is not null)
            return Results.ValidationProblem(passwordErrors);

        var user = await db.Users.FindAsync([userId.Value], ct);
        if (user is null)
            return Results.NotFound();

        if (!hasher.Verify(request.CurrentPassword, user.PasswordHash))
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["currentPassword"] = ["Current password is incorrect."]
            });

        user.PasswordHash = hasher.Hash(request.NewPassword);

        // Revoke all refresh tokens on password change
        var activeTokens = await db.RefreshTokens
            .Where(t => t.UserId == userId && t.RevokedAt == null)
            .ToListAsync(ct);

        foreach (var token in activeTokens)
            token.RevokedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(ct);

        return Results.NoContent();
    }

    private static async Task<IResult> DeleteAccount(
        AuthDbContext db,
        NatsEventPublisher nats,
        HttpContext httpContext,
        ILogger<Program> logger,
        CancellationToken ct)
    {
        var userId = GetUserId(httpContext);
        if (userId is null)
            return Results.Unauthorized();

        var user = await db.Users.FindAsync([userId.Value], ct);
        if (user is null)
            return Results.NotFound();

        // Publish FIRST — if NATS is down, nothing is deleted and caller can retry.
        // Safe failure direction: downstream services may delete data that auth
        // will also delete on retry, but no data is silently orphaned.
        await nats.PublishAsync(Subjects.UserDeleted,
            new UserDeletedEvent(userId.Value), ct);

        db.Users.Remove(user);
        await db.SaveChangesAsync(ct);

        ClearRefreshCookie(httpContext);

        return Results.NoContent();
    }

    private static async Task<IResult> SearchUsers(
        string? q,
        AuthDbContext db,
        HttpContext httpContext,
        CancellationToken ct)
    {
        if (GetUserId(httpContext) is null)
            return Results.Unauthorized();

        if (string.IsNullOrWhiteSpace(q) || q.Length < 2)
            return Results.Ok(Array.Empty<UserSearchResult>());

        var query = q.Trim().ToLowerInvariant();

        var results = await db.Users
            .Where(u => u.Username.Contains(query) ||
                        (u.DisplayName != null && u.DisplayName.ToLower().Contains(query)))
            .OrderBy(u => u.Username)
            .Take(20)
            .Select(u => new UserSearchResult(u.Id, u.Username, u.DisplayName, u.AvatarUrl))
            .ToListAsync(ct);

        return Results.Ok(results);
    }

    private static async Task<IResult> ExportData(
        AuthDbContext db,
        IHttpClientFactory httpClientFactory,
        ExportRateLimiter rateLimiter,
        HttpContext httpContext,
        ILogger<Program> logger,
        CancellationToken ct)
    {
        var userId = GetUserId(httpContext);
        if (userId is null)
            return Results.Unauthorized();

        if (!rateLimiter.TryAcquire(userId.Value))
            return Results.Problem(
                statusCode: StatusCodes.Status429TooManyRequests,
                title: "Too Many Requests",
                detail: "Data export is limited to one request per minute. Please try again later.");

        var user = await db.Users.FindAsync([userId.Value], ct);
        if (user is null)
            return Results.NotFound();

        // Auth service's own export data
        var authExport = new
        {
            service = "auth",
            data = new
            {
                userId = user.Id,
                email = user.Email,
                username = user.Username,
                displayName = user.DisplayName,
                avatarUrl = user.AvatarUrl,
                createdAt = user.CreatedAt,
                lastLoginAt = user.LastLoginAt
            }
        };

        // Fan out to downstream services in parallel
        var serviceExports = new List<object> { authExport };

        var serviceCalls = new (string Name, string Path)[]
        {
            ("HabitService", $"/habits/internal/export/{userId}"),
            ("SocialService", $"/social/internal/export/{userId}"),
            ("ChallengeService", $"/challenges/internal/export/{userId}"),
            ("NotificationService", $"/notifications/internal/export/{userId}"),
            ("ActivityService", $"/activity/internal/export/{userId}"),
        };

        var warnings = new List<string>();

        var tasks = serviceCalls.Select(async svc =>
        {
            try
            {
                var client = httpClientFactory.CreateClient(svc.Name);
                using var response = await client.GetAsync(svc.Path, ct);
                if (response.IsSuccessStatusCode)
                {
                    var json = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct);
                    return (svc.Name, Data: (object?)json, Failed: false);
                }

                if (response.StatusCode != System.Net.HttpStatusCode.NotFound)
                {
                    logger.LogWarning("Export from {Service} returned {StatusCode} for UserId={UserId}",
                        svc.Name, (int)response.StatusCode, userId);
                    return (svc.Name, Data: null, Failed: true);
                }

                return (svc.Name, Data: null, Failed: false);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                logger.LogWarning(ex, "Failed to fetch export from {Service} for UserId={UserId}", svc.Name, userId);
                return (svc.Name, Data: null, Failed: true);
            }
        });

        var results = await Task.WhenAll(tasks);
        foreach (var (name, data, failed) in results)
        {
            if (data is not null)
                serviceExports.Add(data);
            if (failed)
                warnings.Add($"Failed to export data from {name}");
        }

        return Results.Ok(new
        {
            exportedAt = DateTimeOffset.UtcNow,
            services = serviceExports,
            warnings
        });
    }

    private static async Task<IResult> InternalExport(
        Guid userId,
        AuthDbContext db,
        CancellationToken ct)
    {
        var user = await db.Users.FindAsync([userId], ct);
        if (user is null)
            return Results.NotFound();

        return Results.Ok(new
        {
            service = "auth",
            data = new
            {
                userId = user.Id,
                email = user.Email,
                username = user.Username,
                displayName = user.DisplayName,
                avatarUrl = user.AvatarUrl,
                createdAt = user.CreatedAt,
                lastLoginAt = user.LastLoginAt
            }
        });
    }

    private static async Task<IResult> ResolveUsername(
        string username,
        AuthDbContext db,
        CancellationToken ct)
    {
        var usernameLower = username.Trim().ToLowerInvariant();
        var user = await db.Users
            .Where(u => u.Username == usernameLower)
            .Select(u => new { u.Id })
            .FirstOrDefaultAsync(ct);

        return user is null ? Results.NotFound() : Results.Ok(new { userId = user.Id });
    }

    private static async Task<IResult> BatchProfiles(
        BatchProfilesRequest request,
        AuthDbContext db,
        CancellationToken ct)
    {
        if (request.UserIds is null || request.UserIds.Count == 0)
            return Results.Ok(Array.Empty<object>());

        // Cap at 100 to prevent abuse
        var ids = request.UserIds.Distinct().Take(100).ToList();

        var profiles = await db.Users
            .Where(u => ids.Contains(u.Id))
            .Select(u => new { u.Id, u.Username, u.DisplayName })
            .ToListAsync(ct);

        return Results.Ok(profiles.Select(p => new
        {
            userId = p.Id,
            username = p.Username,
            displayName = p.DisplayName
        }));
    }

    private static Guid? GetUserId(HttpContext httpContext)
    {
        // Gateway injects X-User-Id from JWT claims
        var header = httpContext.Request.Headers["X-User-Id"].FirstOrDefault();
        return Guid.TryParse(header, out var id) ? id : null;
    }

    private static async Task<RefreshToken> CreateRefreshToken(
        AuthDbContext db,
        TokenService tokens,
        Guid userId,
        CancellationToken ct)
    {
        var refreshToken = new RefreshToken
        {
            UserId = userId,
            Token = tokens.GenerateRefreshToken(),
            ExpiresAt = DateTimeOffset.UtcNow.Add(tokens.RefreshTokenLifetime)
        };

        db.RefreshTokens.Add(refreshToken);
        await db.SaveChangesAsync(ct);

        return refreshToken;
    }

    private static void SetRefreshCookie(HttpContext httpContext, string token, DateTimeOffset expiresAt)
    {
        httpContext.Response.Cookies.Append(RefreshCookieName, token, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Strict,
            Secure = true,
            Expires = expiresAt,
            Path = "/auth"
        });
    }

    private static void ClearRefreshCookie(HttpContext httpContext)
    {
        httpContext.Response.Cookies.Delete(RefreshCookieName, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Strict,
            Secure = true,
            Path = "/auth"
        });
    }

    private static UserProfile ToProfile(User user) =>
        new(user.Id, user.Email, user.Username, user.DisplayName, user.AvatarUrl, user.CreatedAt);
}
