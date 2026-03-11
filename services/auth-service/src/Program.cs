using Winzy.AuthService.Data;
using Winzy.Common.Health;
using Winzy.Common.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddServiceDatabase<AuthDbContext>(builder.Configuration);
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AuthDbContext>();

var app = builder.Build();

app.MapOpenApi();
app.MapServiceHealthChecks();

app.Run();
