namespace Winzy.Gateway.Tests;

public class JwtSecretValidationTests
{
    [Fact]
    public void NullSecret_ThrowsWithConfigurationHint()
    {
        var ex = Assert.Throws<InvalidOperationException>(() => JwtSecretValidator.Validate(null));

        Assert.Contains("Jwt:Secret", ex.Message);
        Assert.Contains("not configured", ex.Message);
    }

    [Fact]
    public void EmptyString_ThrowsWithConfigurationHint()
    {
        var ex = Assert.Throws<InvalidOperationException>(() => JwtSecretValidator.Validate(""));

        Assert.Contains("Jwt:Secret", ex.Message);
        Assert.Contains("not configured", ex.Message);
    }

    [Theory]
    [InlineData(" ")]
    [InlineData("   ")]
    [InlineData("\t")]
    [InlineData("\n")]
    public void WhitespaceOnly_ThrowsWithConfigurationHint(string secret)
    {
        var ex = Assert.Throws<InvalidOperationException>(() => JwtSecretValidator.Validate(secret));

        Assert.Contains("Jwt:Secret", ex.Message);
        Assert.Contains("not configured", ex.Message);
    }

    [Theory]
    [InlineData("your-secret-key")]
    [InlineData("change-me")]
    [InlineData("secret")]
    [InlineData("placeholder")]
    [InlineData("your-jwt-secret")]
    public void KnownPlaceholder_ThrowsBeforeStartup(string secret)
    {
        // All built-in placeholders are < 32 chars, so they hit the length check.
        // The important thing: they are rejected, and the message is diagnostic.
        var ex = Assert.Throws<InvalidOperationException>(() => JwtSecretValidator.Validate(secret));

        Assert.Contains("Jwt:Secret", ex.Message);
        Assert.Contains(secret.Length.ToString(), ex.Message);
    }

    [Theory]
    [InlineData("YOUR-SECRET-KEY")]
    [InlineData("CHANGE-ME")]
    [InlineData("SECRET")]
    [InlineData("PLACEHOLDER")]
    [InlineData("Your-Jwt-Secret")]
    public void CaseInsensitivePlaceholder_AlsoThrows(string secret)
    {
        var ex = Assert.Throws<InvalidOperationException>(() => JwtSecretValidator.Validate(secret));

        Assert.Contains("Jwt:Secret", ex.Message);
    }

    [Fact]
    public void TooShort_31Chars_ThrowsWithLengthInformation()
    {
        var secret = new string('x', 31);

        var ex = Assert.Throws<InvalidOperationException>(() => JwtSecretValidator.Validate(secret));

        Assert.Contains("at least 32 characters", ex.Message);
        Assert.Contains("31", ex.Message);
    }

    [Fact]
    public void Exactly32Chars_Passes()
    {
        var secret = new string('a', 32);

        var exception = Record.Exception(() => JwtSecretValidator.Validate(secret));

        Assert.Null(exception);
    }

    [Fact]
    public void ValidLongSecret_Passes()
    {
        const string secret = "this-is-a-very-long-and-valid-jwt-signing-secret-key-1234567890!!";

        var exception = Record.Exception(() => JwtSecretValidator.Validate(secret));

        Assert.Null(exception);
    }

    [Fact]
    public void LegacyDefaultSecret_ThrowsAsPlaceholder()
    {
        const string legacy = "CHANGE-THIS-IN-PRODUCTION-minimum-32-characters-long";
        Assert.True(legacy.Length >= 32); // Would pass length check without placeholder list

        var ex = Assert.Throws<InvalidOperationException>(() => JwtSecretValidator.Validate(legacy));

        Assert.Contains("placeholder", ex.Message);
    }

    [Theory]
    [InlineData("your-secret-key-your-secret-key!")]
    [InlineData("CHANGE-ME-CHANGE-ME-CHANGE-ME-!!")]
    public void LongNonPlaceholder_Passes(string secret)
    {
        // These are >= 32 chars and are NOT exact placeholder matches, so they pass.
        Assert.True(secret.Length >= 32);

        var exception = Record.Exception(() => JwtSecretValidator.Validate(secret));

        Assert.Null(exception);
    }
}
