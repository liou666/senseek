// Toolbar popups are native extension targets, outside Playwright's tab list.
export async function attachActionPopup(context, url, expect) {
  const browser = await context.browser().newBrowserCDPSession();
  let target;
  await expect.poll(async () => {
    target = (await browser.send("Target.getTargets")).targetInfos.find((item) => item.url === url);
    return Boolean(target);
  }).toBe(true);
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId: target.targetId, flatten: false });
  let sequence = 0;
  const requests = new Map();
  browser.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message), request = requests.get(message.id);
    if (!request) return;
    requests.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { requests.delete(id); reject(new Error(`Timed out: ${method}`)); }, 10000);
      requests.set(id, { resolve, reject, timer });
      browser.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch((error) => {
        requests.delete(id); clearTimeout(timer); reject(error);
      });
    });
  }
  async function evaluate(expression) {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(result.description || exceptionDetails.text);
    return result.value;
  }
  await expect.poll(() => evaluate("document.readyState")).toBe("complete");
  return {
    send, evaluate,
    async isOpen() { return (await browser.send("Target.getTargets")).targetInfos.some((item) => item.targetId === target.targetId); },
    async detach() { for (const request of requests.values()) clearTimeout(request.timer); await browser.detach(); },
  };
}
