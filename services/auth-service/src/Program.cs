using Winzy.AuthService.Data;
using Winzy.AuthService.Endpoints;
using Winzy.AuthService.Services;
using Winzy.Common.Health;
using Winzy.Common.Messaging;
using Winzy.Common.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddServiceDatabase<AuthDbContext>(builder.Configuration);
builder.Services.AddNatsMessaging(builder.Configuration);
builder.Services.AddSingleton<PasswordHasher>();
builder.Services.AddSingleton<TokenService>();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AuthDbContext>()
    .AddNatsHealthCheck();

var app = builder.Build();

app.MapOpenApi();
app.MapServiceHealthChecks();
app.MapAuthEndpoints();

app.Run();

public partial class Program;
