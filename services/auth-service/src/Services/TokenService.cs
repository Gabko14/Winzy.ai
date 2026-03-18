using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Winzy.AuthService.Services;

public sealed class TokenService
{
    private readonly string _secret;
    private readonly TimeSpan _accessTokenLifetime;
    private readonly TimeSpan _refreshTokenLifetime;

    private static readonly string[] _placeholders =
    [
        "your-secret-key",
        "your-jwt-secret",
        "change-me",
        "secret",
        "placeholder",
        "CHANGE-THIS-IN-PRODUCTION-minimum-32-characters-long"
    ];

    public TokenService(IConfiguration config)
    {
        var secret = config["Jwt:Secret"];
        if (string.IsNullOrWhiteSpace(secret))
            throw new InvalidOperationException(
                "Jwt:Secret is not configured. Set it via environment variable Jwt__Secret or in appsettings.json.");

        if (secret.Length < 32)
            throw new InvalidOperationException(
                $"Jwt:Secret must be at least 32 characters for HMAC-SHA256. Current length: {secret.Length}.");

        if (_placeholders.Any(p => secret.Equals(p, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException(
                "Jwt:Secret is still set to a placeholder value. Set a real secret before starting the auth service.");

        _secret = secret;
        _accessTokenLifetime = TimeSpan.FromMinutes(
            config.GetValue("Jwt:AccessTokenMinutes", 15));
        _refreshTokenLifetime = TimeSpan.FromDays(
            config.GetValue("Jwt:RefreshTokenDays", 7));
    }

    public TimeSpan RefreshTokenLifetime => _refreshTokenLifetime;

    public string GenerateAccessToken(Guid userId, string email)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, email),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };

        var token = new JwtSecurityToken(
            claims: claims,
            expires: DateTime.UtcNow.Add(_accessTokenLifetime),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string GenerateRefreshToken()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
    }

    public ClaimsPrincipal? ValidateAccessToken(string token)
    {
        var handler = new JwtSecurityTokenHandler();
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_secret));

        try
        {
            return handler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = key,
                ValidateIssuer = false,
                ValidateAudience = false,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.Zero
            }, out _);
        }
        catch
        {
            return null;
        }
    }
}
