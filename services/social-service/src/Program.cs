using Winzy.Common.Health;
using Winzy.Common.Observability;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddHealthChecks();

var app = builder.Build();

app.UseObservability();
app.MapOpenApi();
app.MapServiceHealthChecks();

app.Run();
