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
        group.MapGet("/users/search", SearchUsers);
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
        await db.SaveChangesAsync(ct);

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
        AuthDbContext db,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var userId = GetUserId(httpContext);
        if (userId is null)
            return Results.Unauthorized();

        var tokenValue = httpContext.Request.Cookies[RefreshCookieName];

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
            user.DisplayName = request.DisplayName.Trim();
        if (request.AvatarUrl is not null)
            user.AvatarUrl = request.AvatarUrl.Trim();

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

        db.Users.Remove(user);
        await db.SaveChangesAsync(ct);

        // user.deleted is a GDPR cascade event — must not be silently swallowed.
        // If NATS is down, the delete fails visibly so the caller can retry.
        await nats.PublishAsync(Subjects.UserDeleted,
            new UserDeletedEvent(userId.Value), ct);

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
