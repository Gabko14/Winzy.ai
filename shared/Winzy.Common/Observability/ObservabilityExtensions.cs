using Microsoft.AspNetCore.Builder;
using Serilog;
using Serilog.Events;

namespace Winzy.Common.Observability;

public static class ObservabilityExtensions
{
    /// <summary>
    /// Configures Serilog as the logging provider with Console + Seq sinks,
    /// service-name enrichment, and noisy-namespace suppression.
    /// </summary>
    public static WebApplicationBuilder AddObservability(this WebApplicationBuilder builder, string serviceName)
    {
        var seqUrl = builder.Configuration["Seq:Url"] ?? "http://seq:5341";

        builder.Services.AddSerilog((services, config) => config
            .ReadFrom.Configuration(builder.Configuration)
            .ReadFrom.Services(services)
            .Enrich.FromLogContext()
            .Enrich.WithProperty("ServiceName", serviceName)
            .Enrich.WithMachineName()
            .WriteTo.Console()
            .WriteTo.Seq(seqUrl)
            .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
            .MinimumLevel.Override("Microsoft.EntityFrameworkCore.Database.Command", LogEventLevel.Warning)
            .MinimumLevel.Override("NATS", LogEventLevel.Warning));

        return builder;
    }

    /// <summary>
    /// Adds correlation ID and request logging middleware to the pipeline.
    /// Call early in the pipeline — before authentication and routing — so all
    /// downstream middleware and handlers inherit the correlation scope.
    /// </summary>
    public static IApplicationBuilder UseObservability(this IApplicationBuilder app)
    {
        app.UseMiddleware<CorrelationIdMiddleware>();
        app.UseMiddleware<RequestLoggingMiddleware>();
        return app;
    }
}
