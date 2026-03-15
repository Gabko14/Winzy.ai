using System.ComponentModel.DataAnnotations;

namespace Winzy.AuthService.Models;

public record RegisterRequest(
    [Required, EmailAddress, MaxLength(256)] string Email,
    [Required, RegularExpression(@"^[a-zA-Z0-9_-]{3,64}$",
        ErrorMessage = "Username must be 3-64 characters: letters, digits, hyphens, underscores only.")]
    string Username,
    [Required, MinLength(8), MaxLength(128)] string Password,
    [MaxLength(128)] string? DisplayName);

public record LoginRequest(
    [Required] string EmailOrUsername,
    [Required] string Password);

public record RefreshRequest(string? RefreshToken);

public record ChangePasswordRequest(
    [Required] string CurrentPassword,
    [Required, MinLength(8), MaxLength(128)] string NewPassword);

public record UpdateProfileRequest(
    [MaxLength(128)] string? DisplayName,
    [MaxLength(512)] string? AvatarUrl);

public record AuthResponse(
    string AccessToken,
    string? RefreshToken,
    UserProfile User);

public record UserProfile(
    Guid Id,
    string Email,
    string Username,
    string? DisplayName,
    string? AvatarUrl,
    DateTimeOffset CreatedAt);

public record UserSearchResult(
    Guid Id,
    string Username,
    string? DisplayName,
    string? AvatarUrl);

public record BatchProfilesRequest(List<Guid>? UserIds);
