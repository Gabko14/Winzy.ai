using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Winzy.Gateway.Tests;

public class ForwardedHeadersTrustTests
{
    /// <summary>
    /// Sends a request with X-Forwarded-For through a test server configured with the
    /// given trusted proxies. The terminal middleware captures the resolved RemoteIpAddress
    /// after ForwardedHeaders middleware processes the request.
    /// </summary>
    private static async Task<string?> GetResolvedIp(
        string[]? trustedProxies, string forwardedFor, IPAddress peerIp)
    {
        var configData = new Dictionary<string, string?>();
        if (trustedProxies is { Length: > 0 })
        {
            for (var i = 0; i < trustedProxies.Length; i++)
                configData[$"ReverseProxy:TrustedProxies:{i}"] = trustedProxies[i];
        }

        string? resolvedIp = null;

        using var host = new HostBuilder()
            .ConfigureWebHost(webBuilder =>
            {
                webBuilder.UseTestServer();
                webBuilder.ConfigureAppConfiguration((_, config) =>
                {
                    config.AddInMemoryCollection(configData);
                });
                webBuilder.ConfigureServices((ctx, services) =>
                {
                    // Mirror the exact configuration logic from Program.cs
                    services.Configure<ForwardedHeadersOptions>(options =>
                    {
                        options.ForwardedHeaders =
                            ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;

                        var proxies = ctx.Configuration.GetSection("ReverseProxy:TrustedProxies")
                            .Get<string[]>();
                        if (proxies is { Length: > 0 })
                        {
                            foreach (var entry in proxies)
                            {
                                if (entry.Contains('/'))
                                {
                                    var parts = entry.Split('/');
                                    options.KnownIPNetworks.Add(
                                        new System.Net.IPNetwork(
                                            IPAddress.Parse(parts[0]), int.Parse(parts[1])));
                                }
                                else
                                {
                                    options.KnownProxies.Add(IPAddress.Parse(entry));
                                }
                            }
                        }
                    });
                });
                webBuilder.Configure(app =>
                {
                    app.UseForwardedHeaders();
                    app.Run(context =>
                    {
                        // Capture the resolved IP after forwarded headers middleware ran
                        resolvedIp = context.Connection.RemoteIpAddress?.ToString();
                        return Task.CompletedTask;
                    });
                });
            })
            .Start();

        var server = host.GetTestServer();
        await server.SendAsync(ctx =>
        {
            ctx.Request.Method = "GET";
            ctx.Request.Path = "/";
            ctx.Request.Headers["X-Forwarded-For"] = forwardedFor;
            ctx.Connection.RemoteIpAddress = peerIp;
        });

        return resolvedIp;
    }

    [Fact]
    public async Task NoTrustedProxies_ForwardedForIgnored()
    {
        var result = await GetResolvedIp(null, "1.2.3.4", IPAddress.Parse("10.0.0.99"));
        Assert.Equal("10.0.0.99", result);
    }

    [Fact]
    public async Task TrustedProxySingleIp_ForwardedForHonored()
    {
        var result = await GetResolvedIp(["10.0.0.99"], "1.2.3.4", IPAddress.Parse("10.0.0.99"));
        Assert.Equal("1.2.3.4", result);
    }

    [Fact]
    public async Task TrustedProxyCidr_ForwardedForHonored()
    {
        var result = await GetResolvedIp(["172.16.0.0/12"], "203.0.113.50", IPAddress.Parse("172.18.0.1"));
        Assert.Equal("203.0.113.50", result);
    }

    [Fact]
    public async Task UntrustedProxy_ForwardedForIgnored()
    {
        var result = await GetResolvedIp(["192.168.1.1"], "1.2.3.4", IPAddress.Parse("10.0.0.99"));
        Assert.Equal("10.0.0.99", result);
    }

    [Fact]
    public async Task UntrustedProxy_OutsideCidr_ForwardedForIgnored()
    {
        var result = await GetResolvedIp(["172.16.0.0/12"], "1.2.3.4", IPAddress.Parse("10.0.0.99"));
        Assert.Equal("10.0.0.99", result);
    }

    [Fact]
    public async Task MultipleTrustedProxies_MixedFormats()
    {
        // Single trusted IP
        var result1 = await GetResolvedIp(["10.0.0.1", "172.16.0.0/12"], "8.8.8.8", IPAddress.Parse("10.0.0.1"));
        Assert.Equal("8.8.8.8", result1);

        // Trusted CIDR
        var result2 = await GetResolvedIp(["10.0.0.1", "172.16.0.0/12"], "9.9.9.9", IPAddress.Parse("172.20.0.5"));
        Assert.Equal("9.9.9.9", result2);
    }

    [Fact]
    public async Task EmptyTrustedProxies_ForwardedForIgnored()
    {
        var result = await GetResolvedIp([], "1.2.3.4", IPAddress.Parse("10.0.0.99"));
        Assert.Equal("10.0.0.99", result);
    }
}
