import { useEffect, useState } from "react";
import { requestAccess, signTransaction } from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";
import { BrowserProvider, Contract, formatEther, type Eip1193Provider } from "ethers";
import { ArrowRight, Check, ExternalLink, LoaderCircle, Radio, Wallet } from "lucide-react";

declare global {
  interface Window {
    ethereum?: Eip1193Provider & {
      isMetaMask?: boolean;
      providers?: Array<Eip1193Provider & { isMetaMask?: boolean }>;
    };
  }
}

type Eip6963Provider = {
  info: { rdns: string; name: string };
  provider: Eip1193Provider;
};

type Direction = "stellar-to-sepolia" | "sepolia-to-stellar";
type Link = { label: string; url: string; hash?: string };
type RelayResult = { links: Link[]; guid: string; sourceTx: string; destinationTx: string; message: string; receivedCount: string };
type RelayJob = { status: "running" | "complete" | "failed"; stage: string; progress: number; result?: RelayResult; error?: string };
type AppConfig = {
  stellar: { eid: number; oapp: string; explorer: string };
  sepolia: { eid: number; chainId: number; oapp: string; explorer: string };
  layerZeroScan: string;
  options: string;
};

const EVM_ABI = [
  "function quoteMessage(uint32 dstEid,string message,bytes options) view returns ((uint256 nativeFee,uint256 lzTokenFee))",
  "function sendMessage(uint32 dstEid,string message,bytes options) payable returns ((bytes32 guid,uint64 nonce,(uint256 nativeFee,uint256 lzTokenFee) fee))",
  "function lastMessage() view returns (string)",
  "function receivedMessageCount() view returns (uint64)",
];

const short = (value?: string) => value ? `${value.slice(0, 7)}…${value.slice(-5)}` : "Not connected";

async function getMetaMaskProvider(): Promise<Eip1193Provider> {
  const discovered = await new Promise<Eip1193Provider | undefined>((resolve) => {
    let settled = false;
    const finish = (provider?: Eip1193Provider) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("eip6963:announceProvider", onAnnouncement as EventListener);
      resolve(provider);
    };
    const onAnnouncement = (event: CustomEvent<Eip6963Provider>) => {
      if (event.detail.info.rdns === "io.metamask") finish(event.detail.provider);
    };
    window.addEventListener("eip6963:announceProvider", onAnnouncement as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.setTimeout(() => finish(), 300);
  });
  if (discovered) return discovered;

  const injected = window.ethereum;
  const legacyMetaMask = injected?.providers?.find((provider) => provider.isMetaMask);
  if (legacyMetaMask) return legacyMetaMask;
  if (injected?.isMetaMask) return injected;
  throw new Error("MetaMask was not detected. Install or enable the MetaMask extension, then reload this page.");
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const apiBase = (import.meta.env.VITE_RELAY_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const text = await response.text();
  if (!text) throw new Error(`Relay returned an empty response (${response.status}); it may be restarting`);
  let body: { error?: string } & T;
  try { body = JSON.parse(text); }
  catch { throw new Error(`Relay returned an invalid response (${response.status})`); }
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

function App() {
  const [config, setConfig] = useState<AppConfig>();
  const [direction, setDirection] = useState<Direction>("stellar-to-sepolia");
  const [stellarAddress, setStellarAddress] = useState("");
  const [evmAddress, setEvmAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("Ready");
  const [error, setError] = useState("");
  const [result, setResult] = useState<RelayResult>();
  const [sourceTx, setSourceTx] = useState("");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Hello across LayerZero");

  useEffect(() => { api<AppConfig>("/config").then(setConfig).catch((e) => setError(e.message)); }, []);

  async function connectStellar() {
    const access = await requestAccess();
    if (access.error) throw new Error(access.error.message);
    setStellarAddress(access.address);
    return access.address;
  }

  async function connectEvm() {
    const metamask = await getMetaMaskProvider();
    const accounts = await metamask.request({ method: "eth_requestAccounts" }) as string[];
    const chainId = await metamask.request({ method: "eth_chainId" }) as string;
    if (Number(BigInt(chainId)) !== 11155111) {
      await metamask.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
    }
    setEvmAddress(accounts[0]);
    return metamask;
  }

  async function sendFromStellar() {
    const address = stellarAddress || await connectStellar();
    setStage("Preparing Stellar transaction");
    const prepared = await api<{ xdr: string; fee: string }>("/stellar/prepare", {
      method: "POST", body: JSON.stringify({ address, message }),
    });
    setStage(`Approve ${Number(prepared.fee) / 1e7} XLM in Freighter`);
    const signed = await signTransaction(prepared.xdr, { networkPassphrase: Networks.TESTNET, address });
    if (signed.error || !signed.signedTxXdr) throw new Error(signed.error?.message ?? "Freighter did not return a signed transaction");
    setStage("Submitting Stellar source transaction");
    const source = await api<{ sourceTx: string; encodedPacket: string }>("/stellar/submit", {
      method: "POST", body: JSON.stringify({ signedXdr: signed.signedTxXdr }),
    });
    setSourceTx(source.sourceTx);
    setProgress(2);
    let { jobId } = await api<{ jobId: string }>("/relay/stellar-to-sepolia/start", {
      method: "POST", body: JSON.stringify(source),
    });
    let pollingFailures = 0;
    for (let attempt = 0; attempt < 600; attempt += 1) {
      try {
        const job = await api<RelayJob>(`/jobs/${jobId}`);
        pollingFailures = 0;
        setStage(job.stage);
        setProgress(job.progress);
        if (job.status === "failed") throw new Error(job.error ?? "Relay failed");
        if (job.status === "complete" && job.result) { setResult(job.result); return; }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("server may have restarted")) {
          setStage("Relay restarted; resuming confirmed source transaction");
          ({ jobId } = await api<{ jobId: string }>("/relay/stellar-to-sepolia/start", {
            method: "POST", body: JSON.stringify({ sourceTx: source.sourceTx }),
          }));
          continue;
        }
        if (message.includes("empty response") || message.includes("invalid response") || message.includes("Failed to fetch")) {
          pollingFailures += 1;
          if (pollingFailures < 10) { setStage(`Relay connection interrupted; retrying (${pollingFailures}/10)`); await new Promise((resolve) => setTimeout(resolve, 2_000)); continue; }
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error("Relay job timed out after 10 minutes");
  }

  async function sendFromSepolia() {
    if (!config) throw new Error("Configuration is still loading");
    const metamask = await getMetaMaskProvider();
    if (!evmAddress) await connectEvm();
    const provider = new BrowserProvider(metamask);
    const signer = await provider.getSigner();
    const oapp = new Contract(config.sepolia.oapp, EVM_ABI, signer);
    setStage("Quoting Sepolia source transaction");
    const fee = await oapp.quoteMessage(config.stellar.eid, message, config.options);
    const bufferedFee = fee.nativeFee * 110n / 100n;
    setStage(`Approve up to ${formatEther(bufferedFee)} Sepolia ETH in MetaMask`);
    const tx = await oapp.sendMessage(config.stellar.eid, message, config.options, { value: bufferedFee });
    await tx.wait();
    setSourceTx(tx.hash);
    setProgress(2);
    setStage("Verifying, committing and executing on Stellar");
    setResult(await api<RelayResult>("/relay/sepolia-to-stellar", {
      method: "POST", body: JSON.stringify({ sourceTx: tx.hash }),
    }));
  }

  async function run() {
    setBusy(true); setError(""); setResult(undefined); setSourceTx(""); setProgress(1);
    try {
      await (direction === "stellar-to-sepolia" ? sendFromStellar() : sendFromSepolia());
      setStage("Delivered");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("Failed");
    } finally { setBusy(false); }
  }

  const source = direction === "stellar-to-sepolia" ? "Stellar" : "Sepolia";
  const destination = direction === "stellar-to-sepolia" ? "Sepolia" : "Stellar";
  const messageBytes = new TextEncoder().encode(message).length;
  const validMessage = messageBytes > 0 && messageBytes <= 256;

  return <main className="mx-auto min-h-screen max-w-6xl px-5 py-8 md:px-10 md:py-14">
    <header className="mb-12 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
      <div>
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-white/[.03] px-3 py-1.5 text-xs text-slate-300">
          <Radio size={13} className="text-mint" /> Live on testnets · LayerZero V2
        </div>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-[-.04em] text-white md:text-6xl">One message.<br/><span className="text-slate-500">Two chains.</span></h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-slate-400">Write a message and approve it in the source wallet. The verifier relay carries the exact canonical payload through ULN302 and proves what was stored at the destination.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <button onClick={() => connectStellar().catch(e => setError(e.message))} className="rounded-xl border border-line bg-panel px-4 py-3 text-left hover:border-mint/50">
          <span className="block text-slate-500">Freighter</span><span className="mt-1 block font-mono text-slate-200">{short(stellarAddress)}</span>
        </button>
        <button onClick={() => connectEvm().catch(e => setError(e.message))} className="rounded-xl border border-line bg-panel px-4 py-3 text-left hover:border-violet/50">
          <span className="block text-slate-500">MetaMask</span><span className="mt-1 block font-mono text-slate-200">{short(evmAddress)}</span>
        </button>
      </div>
    </header>

    <section className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
      <div className="rounded-3xl border border-line bg-panel/90 p-6 shadow-2xl shadow-black/20 md:p-8">
        <p className="mb-4 text-xs font-medium uppercase tracking-[.18em] text-slate-500">Direction</p>
        <div className="mb-8 grid grid-cols-2 gap-3">
          {(["stellar-to-sepolia", "sepolia-to-stellar"] as Direction[]).map((item) => {
            const active = direction === item;
            return <button key={item} onClick={() => { setDirection(item); setResult(undefined); }} className={`rounded-2xl border p-4 text-left transition ${active ? "border-mint/60 bg-mint/[.07]" : "border-line bg-ink/40 hover:border-slate-600"}`}>
              <span className="text-sm font-medium text-white">{item === "stellar-to-sepolia" ? "Stellar → Sepolia" : "Sepolia → Stellar"}</span>
              <span className="mt-1 block text-xs text-slate-500">Send and store a message</span>
            </button>;
          })}
        </div>

        <div className="mb-8 flex items-center justify-between rounded-2xl border border-line bg-ink/45 p-5">
          <Chain name={source} eid={source === "Stellar" ? 40600 : 40161} tone={source === "Stellar" ? "mint" : "violet"}/>
          <div className="flex flex-col items-center gap-2 text-slate-600"><ArrowRight/><span className="text-[10px] uppercase tracking-widest">ULN302</span></div>
          <Chain name={destination} eid={destination === "Stellar" ? 40600 : 40161} tone={destination === "Stellar" ? "mint" : "violet"}/>
        </div>

        <label className="mb-8 block">
          <span className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-[.18em] text-slate-500">
            <span>Message</span><span className={messageBytes > 256 ? "text-red-300" : ""}>{messageBytes}/256 bytes</span>
          </span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            placeholder="Type text or a number"
            className="w-full resize-none rounded-2xl border border-line bg-ink/45 p-4 text-sm leading-6 text-white outline-none transition placeholder:text-slate-600 focus:border-mint/60"
          />
        </label>

        <button disabled={busy || !config || !validMessage} onClick={run} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-4 font-medium text-ink transition hover:bg-mint disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <LoaderCircle className="animate-spin" size={19}/> : <Wallet size={19}/>} {busy ? stage : `Approve & send from ${source}`}
        </button>
        {error && <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/[.07] p-4 text-sm leading-6 text-red-200">{error}</div>}
      </div>

      <aside className="rounded-3xl border border-line bg-panel/65 p-6 md:p-8">
        <p className="text-xs font-medium uppercase tracking-[.18em] text-slate-500">Delivery proof</p>
        <div className="mt-6 space-y-5">
          {["Wallet approval", "PacketSent", "DVN verified", "ULN committed", "OApp executed"].map((label, index) => {
            const done = Boolean(result) || index < progress;
            return <div key={label} className="flex items-center gap-3">
              <span className={`grid h-7 w-7 place-items-center rounded-full border ${done ? "border-mint/50 bg-mint/10 text-mint" : "border-line text-slate-600"}`}>{done ? <Check size={14}/> : index + 1}</span>
              <span className={done ? "text-sm text-slate-200" : "text-sm text-slate-500"}>{label}</span>
            </div>;
          })}
        </div>
        {sourceTx && !result && config && <div className="mt-8 border-t border-line pt-6">
          <p className="mb-3 text-xs text-slate-500">Source transaction is confirmed. Destination relay continues in the background.</p>
          <div className="space-y-2">
            <a href={(direction === "stellar-to-sepolia" ? config.stellar.explorer : config.sepolia.explorer) + sourceTx} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5 text-xs text-slate-300 hover:border-slate-500"><span>Source transaction</span><ExternalLink size={13}/></a>
            <a href={config.layerZeroScan + sourceTx} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5 text-xs text-slate-300 hover:border-slate-500"><span>LayerZero Scan</span><ExternalLink size={13}/></a>
          </div>
        </div>}
        {result && <div className="mt-8 border-t border-line pt-6">
          <div className="mb-4">
            <span className="text-sm text-slate-400">Stored on {destination}</span>
            <div className="mt-2 break-words rounded-xl border border-mint/25 bg-mint/[.06] p-4 text-sm leading-6 text-white">{result.message}</div>
            <p className="mt-2 text-xs text-slate-500">Received messages: {result.receivedCount}</p>
          </div>
          <div className="space-y-2">{result.links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5 text-xs text-slate-300 hover:border-slate-500"><span>{link.label}</span><ExternalLink size={13}/></a>)}</div>
        </div>}
      </aside>
    </section>

    <footer className="mt-8 flex flex-col gap-2 text-xs text-slate-600 md:flex-row md:justify-between">
      <span>Stellar OApp {short(config?.stellar.oapp)} · Sepolia OApp {short(config?.sepolia.oapp)}</span>
      <span>Testnet assets only · single-signer validation relay</span>
    </footer>
  </main>;
}

function Chain({ name, eid, tone }: { name: string; eid: number; tone: "mint" | "violet" }) {
  return <div className="min-w-24 text-center"><span className={`mx-auto mb-2 grid h-10 w-10 place-items-center rounded-xl ${tone === "mint" ? "bg-mint/10 text-mint" : "bg-violet/10 text-violet"}`}>{name[0]}</span><strong className="block text-sm text-white">{name}</strong><span className="text-[11px] text-slate-500">EID {eid}</span></div>;
}

export default App;
