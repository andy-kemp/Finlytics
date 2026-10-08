using System.Net;
using System.Security.Claims;
using System.Text;
using Azure.Core.Serialization;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.DependencyInjection;

sealed class TestRequest : HttpRequestData
{
    private readonly Stream body;
    private readonly bool forbidBody;
    public TestRequest(string json, string? token, bool forbidBody = false) : base(new TestContext())
    {
        this.forbidBody = forbidBody;
        body = new MemoryStream(Encoding.UTF8.GetBytes(json));
        if (token != null) Headers.Add("Authorization", "Bearer " + token);
    }
    public override Stream Body => forbidBody ? throw new InvalidOperationException("Unauthorized body access") : body;
    public override HttpHeadersCollection Headers { get; } = new();
    public override IReadOnlyCollection<IHttpCookie> Cookies => Array.Empty<IHttpCookie>();
    public override Uri Url => new("https://localhost/api/vat-returns/1/settlement");
    public override IEnumerable<ClaimsIdentity> Identities => Array.Empty<ClaimsIdentity>();
    public override string Method => "POST";
    public override HttpResponseData CreateResponse() => new TestResponse(FunctionContext);
}

sealed class TestResponse(FunctionContext context) : HttpResponseData(context)
{
    public override HttpStatusCode StatusCode { get; set; }
    public override HttpHeadersCollection Headers { get; set; } = new();
    public override Stream Body { get; set; } = new MemoryStream();
    public override HttpCookies Cookies => throw new NotSupportedException();
}

sealed class TestContext : FunctionContext
{
    private static readonly IServiceProvider services = new ServiceCollection()
        .Configure<WorkerOptions>(options => options.Serializer = new JsonObjectSerializer())
        .BuildServiceProvider();
    public override string InvocationId => "isolated-test";
    public override string FunctionId => "vat-settlement-test";
    public override TraceContext TraceContext => throw new NotSupportedException();
    public override BindingContext BindingContext => throw new NotSupportedException();
    public override RetryContext RetryContext => throw new NotSupportedException();
    public override IServiceProvider InstanceServices { get; set; } = services;
    public override FunctionDefinition FunctionDefinition => throw new NotSupportedException();
    public override IDictionary<object, object> Items { get; set; } = new Dictionary<object, object>();
    public override IInvocationFeatures Features => throw new NotSupportedException();
}
