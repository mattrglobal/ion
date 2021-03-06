import * as getRawBody from 'raw-body';
import * as Koa from 'koa';
import * as Router from 'koa-router';
import Ipfs from '@decentralized-identity/sidetree/dist/lib/ipfs/Ipfs';
import LogColor from '../bin/LogColor';
import {
  SidetreeConfig,
  SidetreeCore,
  SidetreeResponse,
  SidetreeResponseModel,
  SidetreeVersionModel
} from '@decentralized-identity/sidetree';
import { collectDefaultMetrics, register, Counter } from 'prom-client';

collectDefaultMetrics();

// Customized Http Metrics
const httpMetricsLabelNames = ['method', 'path', 'status_code'];
const totalHttpRequestStatusCount = new Counter({
  name: 'nodejs_http_status_code_count',
  help: 'total status code counter',
  labelNames: httpMetricsLabelNames
});

function initMetrics4EachRoute(layer: Router.Layer) {
  layer.stack.unshift(async (ctx, next) => {
    await next();
    totalHttpRequestStatusCount.labels(ctx.method, layer.path, ctx.response.status.toString()).inc();
  });
}

/** Configuration used by this server. */
interface ServerConfig extends SidetreeConfig {
  /** IPFS HTTP API endpoint URI. */
  ipfsHttpApiEndpointUri: string;

  /** Port to be used by the server. */
  port: number;
}

// Selecting core config file, environment variable overrides default config file.
let configFilePath = '../json/testnet-core-config.json';
if (process.env.ION_CORE_CONFIG_FILE_PATH === undefined) {
  console.log(LogColor.yellow(`Environment variable ION_CORE_CONFIG_FILE_PATH undefined, using default core config path ${configFilePath} instead.`));
} else {
  configFilePath = process.env.ION_CORE_CONFIG_FILE_PATH;
  console.log(LogColor.lightBlue(`Loading core config from ${LogColor.green(configFilePath)}...`));
}
const config: ServerConfig = require(configFilePath);

// Selecting versioning file, environment variable overrides default config file.
let versioningConfigFilePath = '../json/testnet-core-versioning.json';
if (process.env.ION_CORE_VERSIONING_CONFIG_FILE_PATH === undefined) {
  console.log(LogColor.yellow(`Environment variable ION_CORE_VERSIONING_CONFIG_FILE_PATH undefined, using default core versioning config path ${versioningConfigFilePath} instead.`));
} else {
  versioningConfigFilePath = process.env.ION_CORE_VERSIONING_CONFIG_FILE_PATH;
  console.log(LogColor.lightBlue(`Loading core versioning config from ${LogColor.green(versioningConfigFilePath)}...`));
}
const coreVersions: SidetreeVersionModel[] = require(versioningConfigFilePath);

const ipfsFetchTimeoutInSeconds = 10;
const cas = new Ipfs(config.ipfsHttpApiEndpointUri, ipfsFetchTimeoutInSeconds);
const sidetreeCore = new SidetreeCore(config, coreVersions, cas);
const app = new Koa();

// Raw body parser.
app.use(async (ctx, next) => {
  ctx.body = await getRawBody(ctx.req);
  await next();
});

const router = new Router();

router.get('/metrics', (ctx) => {
  ctx.headers['content-type'] = register.contentType;
  ctx.body = register.metrics();
});

router.post('/operations', async (ctx, _next) => {
  const response = await sidetreeCore.handleOperationRequest(ctx.body);
  setKoaResponse(response, ctx.response);
});

router.get('/version', async (ctx, _next) => {
  const response = await sidetreeCore.handleGetVersionRequest();
  setKoaResponse(response, ctx.response);
});

const resolvePath = '/identifiers/';
router.get(`${resolvePath}:did`, async (ctx, _next) => {
  // Strip away the first '/identifiers/' string.
  const didOrDidDocument = ctx.url.split(resolvePath)[1];
  const response = await sidetreeCore.handleResolveRequest(didOrDidDocument);
  setKoaResponse(response, ctx.response);
});

router.stack.forEach(initMetrics4EachRoute);

app.use(router.routes())
   .use(router.allowedMethods());

// Handler to return bad request for all unhandled paths.
app.use((ctx, _next) => {
  ctx.response.status = 400;
});

sidetreeCore.initialize()
.then(() => {
  const port = config.port;
  app.listen(port, () => {
    console.log(`Sidetree node running on port: ${port}`);
  });
})
.catch((error: Error) => {
  console.log(`Sidetree node initialization failed with error ${error}`);
  process.exit(1);
});

/**
 * Sets the koa response according to the Sidetree response object given.
 */
const setKoaResponse = (response: SidetreeResponseModel, koaResponse: Koa.Response) => {
  koaResponse.status = SidetreeResponse.toHttpStatus(response.status);

  if (response.body) {
    koaResponse.set('Content-Type', 'application/json');
    koaResponse.body = response.body;
  } else {
    // Need to set the body explicitly to empty string, else koa will echo the request as the response.
    koaResponse.body = '';
  }
};
