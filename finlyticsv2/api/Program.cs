using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using FinlyticsV2.Api.Services;

var host = new HostBuilder()
	.ConfigureFunctionsWorkerDefaults()
	.ConfigureServices(services =>
	{
		services.AddScoped<UserContextService>();
	})
	.Build();

host.Run();
