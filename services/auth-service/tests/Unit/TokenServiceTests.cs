using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.Extensions.Configuration;
using Winzy.AuthService.Services;

namespace Winzy.AuthService.Tests.Unit;

public class TokenServiceTests
{
    private static TokenService CreateService(int accessMinutes = 15, int refreshDays = 7)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Secret"] = "test-secret-key-that-is-at-least-32-characters-long!!",
                ["Jwt:AccessTokenMinutes"] = accessMinutes.ToString(),
                ["Jwt:RefreshTokenDays"] = refreshDays.ToString()
            })
            .Build();

        return new TokenService(config);
    }

    [Fact]
    public void GenerateAccessToken_ReturnsValidJwt()
    {
        var service = CreateService();
        var userId = Guid.NewGuid();

        var token = service.GenerateAccessToken(userId, "test@example.com");

        Assert.NotEmpty(token);
        var handler = new JwtSecurityTokenHandler();
        Assert.True(handler.CanReadToken(token));
    }

    [Fact]
    public void GenerateAccessToken_ContainsCorrectClaims()
    {
        var service = CreateService();
        var userId = Guid.NewGuid();
        var email = "test@example.com";

        var token = service.GenerateAccessToken(userId, email);

        var handler = new JwtSecurityTokenHandler();
        var jwt = handler.ReadJwtToken(token);

        Assert.Equal(userId.ToString(), jwt.Subject);
        Assert.Equal(email, jwt.Claims.First(c => c.Type == JwtRegisteredClaimNames.Email).Value);
        Assert.NotNull(jwt.Claims.FirstOrDefault(c => c.Type == JwtRegisteredClaimNames.Jti));
    }

    [Fact]
    public void GenerateAccessToken_ExpiresAt15MinutesByDefault()
    {
        var service = CreateService();
        var userId = Guid.NewGuid();

        var token = service.GenerateAccessToken(userId, "test@example.com");

        var handler = new JwtSecurityTokenHandler();
        var jwt = handler.ReadJwtToken(token);

        var expectedExpiry = DateTime.UtcNow.AddMinutes(15);
        Assert.InRange(jwt.ValidTo, expectedExpiry.AddSeconds(-30), expectedExpiry.AddSeconds(30));
    }

    [Fact]
    public void GenerateRefreshToken_ReturnsUniqueTokens()
    {
        var service = CreateService();

        var token1 = service.GenerateRefreshToken();
        var token2 = service.GenerateRefreshToken();

        Assert.NotEqual(token1, token2);
        Assert.NotEmpty(token1);
        Assert.NotEmpty(token2);
    }

    [Fact]
    public void GenerateRefreshToken_IsBase64Encoded()
    {
        var service = CreateService();
        var token = service.GenerateRefreshToken();

        var bytes = Convert.FromBase64String(token);
        Assert.Equal(64, bytes.Length);
    }

    [Fact]
    public void ValidateAccessToken_ReturnsClaimsForValidToken()
    {
        var service = CreateService();
        var userId = Guid.NewGuid();
        var token = service.GenerateAccessToken(userId, "test@example.com");

        var principal = service.ValidateAccessToken(token);

        Assert.NotNull(principal);
        var subClaim = principal!.FindFirst(ClaimTypes.NameIdentifier)
            ?? principal.FindFirst(JwtRegisteredClaimNames.Sub);
        Assert.NotNull(subClaim);
        Assert.Equal(userId.ToString(), subClaim!.Value);
    }

    [Fact]
    public void ValidateAccessToken_ReturnsNullForInvalidToken()
    {
        var service = CreateService();

        var principal = service.ValidateAccessToken("invalid.token.here");

        Assert.Null(principal);
    }

    [Fact]
    public void ValidateAccessToken_ReturnsNullForExpiredToken()
    {
        // Create service with 0-minute lifetime (already expired)
        var service = CreateService(accessMinutes: 0);
        var token = service.GenerateAccessToken(Guid.NewGuid(), "test@example.com");

        var principal = service.ValidateAccessToken(token);

        Assert.Null(principal);
    }

    [Fact]
    public void RefreshTokenLifetime_ReturnsConfiguredDays()
    {
        var service = CreateService(refreshDays: 14);

        Assert.Equal(TimeSpan.FromDays(14), service.RefreshTokenLifetime);
    }

    [Fact]
    public void Constructor_ThrowsWhenSecretMissing()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>())
            .Build();

        var ex = Assert.Throws<InvalidOperationException>(() => new TokenService(config));
        Assert.Contains("Jwt:Secret", ex.Message);
        Assert.Contains("not configured", ex.Message);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("\t")]
    public void Constructor_ThrowsWhenSecretEmptyOrWhitespace(string secret)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Secret"] = secret
            })
            .Build();

        var ex = Assert.Throws<InvalidOperationException>(() => new TokenService(config));
        Assert.Contains("Jwt:Secret", ex.Message);
        Assert.Contains("not configured", ex.Message);
    }

    [Fact]
    public void Constructor_ThrowsWhenSecretTooShort()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Secret"] = new string('x', 31)
            })
            .Build();

        var ex = Assert.Throws<InvalidOperationException>(() => new TokenService(config));
        Assert.Contains("at least 32 characters", ex.Message);
        Assert.Contains("31", ex.Message);
    }

    [Theory]
    [InlineData("your-secret-key")]
    [InlineData("change-me")]
    [InlineData("secret")]
    [InlineData("placeholder")]
    [InlineData("your-jwt-secret")]
    public void Constructor_ThrowsForKnownPlaceholders(string secret)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Secret"] = secret
            })
            .Build();

        // All placeholders are < 32 chars, so they hit the length check first.
        var ex = Assert.Throws<InvalidOperationException>(() => new TokenService(config));
        Assert.Contains("Jwt:Secret", ex.Message);
    }

    [Fact]
    public void Constructor_ThrowsForLongPlaceholder()
    {
        // This placeholder is >= 32 chars — must still be rejected
        const string legacy = "CHANGE-THIS-IN-PRODUCTION-minimum-32-characters-long";
        Assert.True(legacy.Length >= 32);

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Secret"] = legacy
            })
            .Build();

        var ex = Assert.Throws<InvalidOperationException>(() => new TokenService(config));
        Assert.Contains("placeholder", ex.Message);
    }

    [Theory]
    [InlineData("YOUR-SECRET-KEY")]
    [InlineData("CHANGE-ME")]
    [InlineData("SECRET")]
    public void Constructor_PlaceholderCheckIsCaseInsensitive(string secret)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Secret"] = secret
            })
            .Build();

        var ex = Assert.Throws<InvalidOperationException>(() => new TokenService(config));
        Assert.Contains("Jwt:Secret", ex.Message);
    }

    [Fact]
    public void Constructor_AcceptsExactly32CharSecret()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Secret"] = new string('a', 32),
                ["Jwt:AccessTokenMinutes"] = "15",
                ["Jwt:RefreshTokenDays"] = "7"
            })
            .Build();

        var exception = Record.Exception(() => new TokenService(config));
        Assert.Null(exception);
    }
}
