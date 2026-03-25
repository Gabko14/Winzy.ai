using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Winzy.Common.Http;

public static class ServiceClientExtensions
{
    /// <summary>
    /// Registers a named HttpClient for an internal service.
    /// Reads the base URL from configuration (key: "Services:{configKey}"),
    /// falling back to <paramref name="defaultUrl"/> when the key is absent.
    /// </summary>
    public static IHttpClientBuilder AddServiceHttpClient(
        this IServiceCollection services,
        IConfiguration configuration,
        string clientName,
        string configKey,
        string defaultUrl,
        int timeoutSeconds = 5)
    {
        return services.AddHttpClient(clientName, client =>
        {
            var url = configuration[$"Services:{configKey}"] ?? defaultUrl;
            client.BaseAddress = new Uri(url);
            client.Timeout = TimeSpan.FromSeconds(timeoutSeconds);
        });
    }
}
