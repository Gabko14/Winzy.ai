using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;

namespace Winzy.AuthService.Validation;

public static partial class RequestValidator
{
    private static readonly Regex _usernameRegex = UsernamePattern();

    [GeneratedRegex(@"^[a-zA-Z0-9_-]{3,64}$")]
    private static partial Regex UsernamePattern();

    public static Dictionary<string, string[]>? ValidateRegistration(string email, string username, string password)
    {
        var errors = new Dictionary<string, string[]>();

        if (string.IsNullOrWhiteSpace(email) || !new EmailAddressAttribute().IsValid(email.Trim()))
            errors["email"] = ["A valid email address is required."];
        else if (email.Trim().Length > 256)
            errors["email"] = ["Email must not exceed 256 characters."];

        if (string.IsNullOrWhiteSpace(username) || !_usernameRegex.IsMatch(username.Trim()))
            errors["username"] = ["Username must be 3-64 characters: letters, digits, hyphens, underscores only."];

        if (string.IsNullOrWhiteSpace(password) || password.Length < 8)
            errors["password"] = ["Password must be at least 8 characters."];
        else if (password.Length > 128)
            errors["password"] = ["Password must not exceed 128 characters."];

        return errors.Count > 0 ? errors : null;
    }

    public static Dictionary<string, string[]>? ValidateChangePassword(string newPassword)
    {
        var errors = new Dictionary<string, string[]>();

        if (string.IsNullOrWhiteSpace(newPassword) || newPassword.Length < 8)
            errors["newPassword"] = ["Password must be at least 8 characters."];
        else if (newPassword.Length > 128)
            errors["newPassword"] = ["Password must not exceed 128 characters."];

        return errors.Count > 0 ? errors : null;
    }
}
