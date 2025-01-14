import { InjectedConnector } from "@web3-react/injected-connector";
import { WalletConnectConnector } from "@web3-react/walletconnect-connector";
import { WalletLinkConnector } from "@web3-react/walletlink-connector";
// import { LedgerConnector } from "@web3-react/ledger-connector";
// import { TrezorConnector } from "@web3-react/trezor-connector";
// import { FrameConnector } from "@web3-react/frame-connector";
import { FortmaticConnector } from "@web3-react/fortmatic-connector";
import { PortisConnector } from "@web3-react/portis-connector";
// import { SquarelinkConnector } from "@web3-react/squarelink-connector";
// import { TorusConnector } from "@web3-react/torus-connector";
// import { AuthereumConnector } from "@web3-react/authereum-connector";
import { NetworkConnector } from "@web3-react/network-connector";

const POLLING_INTERVAL = 12000;
const RPC_URLS = {
  // 1: process.env.NEXT_PUBLIC_PROVIDER,
  1: "https://mainnet.infura.io/v3/2b150eabf65140efb3d5508a888ee93e",
  4689: "https://babel-api.mainnet.iotex.io"
};

export const network = new NetworkConnector({ urls: { 1: RPC_URLS[1] } });

export const injected = new InjectedConnector({
  supportedChainIds: [1, 4689]
});

export const walletconnect = new WalletConnectConnector({
  rpc: { 4689: RPC_URLS[4689] },
  bridge: "https://bridge.walletconnect.org",
  qrcode: true,
  pollingInterval: POLLING_INTERVAL
});

export const walletlink = new WalletLinkConnector({
  url: RPC_URLS[4689],
  appName: "veToken"
});

export const fortmatic = new FortmaticConnector({
  apiKey: "pk_live_F95FEECB1BE324B5",
  chainId: 1
});

export const portis = new PortisConnector({
  dAppId: "5dea304b-33ed-48bd-8f00-0076a2546b60",
  networks: [1, 100]
});
