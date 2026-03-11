using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NATS.Client.Hosting;
using Winzy.Common.Health;

namespace Winzy.Common.Messaging;

public static class NatsServiceExtensions
{
    public static IServiceCollection AddNatsMessaging(
        this IServiceCollection services,
        IConfiguration config)
    {
        var natsUrl = config["Nats:Url"] ?? "nats://localhost:4222";

        services.AddNats(configureOpts: opts => opts with { Url = natsUrl });
        services.AddHostedService<JetStreamSetup>();
        services.AddSingleton<NatsEventPublisher>();

        return services;
    }

    /// <summary>
    /// Registers NATS messaging and adds a NATS health check.
    /// Use this instead of calling AddNatsMessaging + AddNatsHealthCheck separately.
    /// </summary>
    public static IHealthChecksBuilder AddNatsMessagingWithHealthCheck(
        this IServiceCollection services,
        IConfiguration config,
        IHealthChecksBuilder healthChecks)
    {
        services.AddNatsMessaging(config);
        return healthChecks.AddNatsHealthCheck();
    }
}
