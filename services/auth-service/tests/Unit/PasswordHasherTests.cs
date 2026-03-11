using Winzy.AuthService.Services;

namespace Winzy.AuthService.Tests.Unit;

public class PasswordHasherTests
{
    private readonly PasswordHasher _hasher = new();

    [Fact]
    public void Hash_ProducesDifferentHashesForSamePassword()
    {
        var hash1 = _hasher.Hash("password123");
        var hash2 = _hasher.Hash("password123");

        Assert.NotEqual(hash1, hash2);
    }

    [Fact]
    public void Hash_ContainsSaltAndHash()
    {
        var result = _hasher.Hash("password123");

        Assert.Contains(":", result);
        var parts = result.Split(':');
        Assert.Equal(2, parts.Length);
        Assert.NotEmpty(parts[0]); // salt
        Assert.NotEmpty(parts[1]); // hash
    }

    [Fact]
    public void Verify_ReturnsTrueForCorrectPassword()
    {
        var hash = _hasher.Hash("correctpassword");

        Assert.True(_hasher.Verify("correctpassword", hash));
    }

    [Fact]
    public void Verify_ReturnsFalseForWrongPassword()
    {
        var hash = _hasher.Hash("correctpassword");

        Assert.False(_hasher.Verify("wrongpassword", hash));
    }

    [Fact]
    public void Verify_ReturnsFalseForMalformedHash()
    {
        Assert.False(_hasher.Verify("password", "notavalidhash"));
    }

    [Fact]
    public void Verify_ReturnsFalseForEmptyHash()
    {
        Assert.False(_hasher.Verify("password", ""));
    }

    [Fact]
    public void Hash_WorksWithMinLengthPassword()
    {
        var hash = _hasher.Hash("12345678"); // 8 chars
        Assert.True(_hasher.Verify("12345678", hash));
    }

    [Fact]
    public void Hash_WorksWithLongPassword()
    {
        var longPassword = new string('a', 128);
        var hash = _hasher.Hash(longPassword);
        Assert.True(_hasher.Verify(longPassword, hash));
    }
}
