using Winzy.Common.Health;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddHealthChecks()
    .AddNatsHealthCheck();

var app = builder.Build();

app.MapOpenApi();
app.MapServiceHealthChecks();

app.Run();
