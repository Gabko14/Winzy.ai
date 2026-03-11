using Winzy.NotificationService.Entities;
using Xunit;

namespace Winzy.NotificationService.Tests.Unit;

public class NotificationSettingsTests
{
    // --- Default values ---

    [Fact]
    public void NewSettings_DefaultsAllEnabled()
    {
        var settings = new NotificationSettings
        {
            UserId = Guid.NewGuid()
        };

        Assert.True(settings.HabitReminders);
        Assert.True(settings.FriendActivity);
        Assert.True(settings.ChallengeUpdates);
    }

    // --- NotificationType enum coverage ---

    [Theory]
    [InlineData(NotificationType.HabitCompleted)]
    [InlineData(NotificationType.FriendRequestSent)]
    [InlineData(NotificationType.FriendRequestAccepted)]
    [InlineData(NotificationType.ChallengeCreated)]
    [InlineData(NotificationType.ChallengeCompleted)]
    public void NotificationType_AllValuesAreDefined(NotificationType type)
    {
        Assert.True(Enum.IsDefined(type));
    }

    [Fact]
    public void NotificationType_HasExpectedCount()
    {
        var values = Enum.GetValues<NotificationType>();
        Assert.Equal(5, values.Length);
    }

    // --- Notification entity defaults ---

    [Fact]
    public void NewNotification_DefaultDataIsEmptyJsonObject()
    {
        var notification = new Notification
        {
            UserId = Guid.NewGuid(),
            Type = NotificationType.HabitCompleted
        };

        Assert.Equal("{}", notification.Data);
        Assert.Null(notification.ReadAt);
    }

    // --- Settings eligibility logic ---

    [Fact]
    public void Settings_HabitRemindersDisabled_BlocksHabitCompleted()
    {
        var settings = new NotificationSettings
        {
            UserId = Guid.NewGuid(),
            HabitReminders = false
        };

        Assert.False(IsNotificationAllowed(settings, NotificationType.HabitCompleted));
    }

    [Fact]
    public void Settings_FriendActivityDisabled_BlocksFriendRequestSent()
    {
        var settings = new NotificationSettings
        {
            UserId = Guid.NewGuid(),
            FriendActivity = false
        };

        Assert.False(IsNotificationAllowed(settings, NotificationType.FriendRequestSent));
    }

    [Fact]
    public void Settings_FriendActivityDisabled_BlocksFriendRequestAccepted()
    {
        var settings = new NotificationSettings
        {
            UserId = Guid.NewGuid(),
            FriendActivity = false
        };

        Assert.False(IsNotificationAllowed(settings, NotificationType.FriendRequestAccepted));
    }

    [Fact]
    public void Settings_ChallengeUpdatesDisabled_BlocksChallengeCreated()
    {
        var settings = new NotificationSettings
        {
            UserId = Guid.NewGuid(),
            ChallengeUpdates = false
        };

        Assert.False(IsNotificationAllowed(settings, NotificationType.ChallengeCreated));
    }

    [Fact]
    public void Settings_ChallengeUpdatesDisabled_BlocksChallengeCompleted()
    {
        var settings = new NotificationSettings
        {
            UserId = Guid.NewGuid(),
            ChallengeUpdates = false
        };

        Assert.False(IsNotificationAllowed(settings, NotificationType.ChallengeCompleted));
    }

    [Fact]
    public void Settings_AllEnabled_AllowsAll()
    {
        var settings = new NotificationSettings
        {
            UserId = Guid.NewGuid(),
            HabitReminders = true,
            FriendActivity = true,
            ChallengeUpdates = true
        };

        foreach (var type in Enum.GetValues<NotificationType>())
        {
            Assert.True(IsNotificationAllowed(settings, type),
                $"Expected {type} to be allowed when all settings are enabled");
        }
    }

    [Fact]
    public void NullSettings_TreatedAsAllEnabled()
    {
        foreach (var type in Enum.GetValues<NotificationType>())
        {
            Assert.True(IsNotificationAllowed(null, type),
                $"Expected {type} to be allowed when settings are null (new user default)");
        }
    }

    /// <summary>
    /// Mirrors the eligibility logic used by subscribers.
    /// When settings are null (new user, no row yet), all notifications are allowed.
    /// </summary>
    private static bool IsNotificationAllowed(NotificationSettings? settings, NotificationType type)
    {
        if (settings is null)
            return true;

        return type switch
        {
            NotificationType.HabitCompleted => settings.HabitReminders,
            NotificationType.FriendRequestSent => settings.FriendActivity,
            NotificationType.FriendRequestAccepted => settings.FriendActivity,
            NotificationType.ChallengeCreated => settings.ChallengeUpdates,
            NotificationType.ChallengeCompleted => settings.ChallengeUpdates,
            _ => true
        };
    }
}
