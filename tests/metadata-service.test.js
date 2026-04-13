const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createMetadataService,
} = require("../backend/services/metadata-service");

test("metadata service reuses cached video info", async () => {
  let runCount = 0;
  const service = createMetadataService({
    runYtDlpCommand: async () => {
      runCount += 1;
      return {
        stdout: JSON.stringify({
          title: "Cached Example",
          thumbnail: "https://example.com/thumb.jpg",
          formats: [{ height: 1080 }, { height: 720 }],
        }),
      };
    },
    sendMessageToClient: () => {},
    logger: { log() {}, error() {} },
  });

  const first = await service.getVideoInfo(
    "client-1",
    "https://example.com/watch?v=123",
    "item-1",
  );
  const second = await service.getVideoInfo(
    "client-1",
    "https://example.com/watch?v=123",
    "item-2",
  );

  assert.equal(runCount, 1);
  assert.deepEqual(second, first);
  assert.deepEqual(service.getCachedVideoInfo("https://example.com/watch?v=123"), first);
});

test("metadata service deduplicates in-flight requests", async () => {
  let runCount = 0;
  let releaseRequest;
  const requestGate = new Promise((resolve) => {
    releaseRequest = resolve;
  });

  const service = createMetadataService({
    runYtDlpCommand: async () => {
      runCount += 1;
      await requestGate;
      return {
        stdout: JSON.stringify({
          title: "In Flight Example",
          thumbnail: null,
          formats: [{ height: 480 }],
        }),
      };
    },
    sendMessageToClient: () => {},
    logger: { log() {}, error() {} },
  });

  const firstRequest = service.getVideoInfo(
    "client-1",
    "https://example.com/watch?v=456",
    "item-1",
  );
  const secondRequest = service.getVideoInfo(
    "client-1",
    "https://example.com/watch?v=456",
    "item-2",
  );

  releaseRequest();

  const [first, second] = await Promise.all([firstRequest, secondRequest]);
  assert.equal(runCount, 1);
  assert.deepEqual(second, first);
});
