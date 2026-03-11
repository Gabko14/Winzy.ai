namespace Winzy.Gateway;

/// <summary>
/// Validates the JWT signing secret at startup. Fail-fast if missing, too short,
/// or still a known placeholder value.
/// </summary>
public static class JwtSecretValidator
{
    private static readonly string[] _placeholders =
    [
        "your-secret-key",
        "your-jwt-secret",
        "change-me",
        "secret",
        "placeholder"
    ];

    public static void Validate(string? secret)
    {
        if (string.IsNullOrWhiteSpace(secret))
            throw new InvalidOperationException(
                "Jwt:Secret is not configured. Set it via environment variable Jwt__Secret or in appsettings.json.");

        if (secret.Length < 32)
            throw new InvalidOperationException(
                $"Jwt:Secret must be at least 32 characters for HMAC-SHA256. Current length: {secret.Length}.");

        if (_placeholders.Any(p => secret.Equals(p, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException(
                "Jwt:Secret is still set to a placeholder value. Set a real secret before starting the gateway.");
    }
}
