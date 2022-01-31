import Head from "next/head";
import classes from "./layout.module.css";
import Link from "next/link";
import Header from "../header";
import SnackbarController from "../snackbar";

export const siteTitle = "MinMaxFinanceDao";

export default function Layout({
  children,
  configure,
  backClicked,
  changeTheme
}) {
  return (
    <div className={classes.container}>
      <Head>
        <link rel="icon" href="/favicon.ico" />
        <link
          rel="preload"
          href="/fonts/Inter/Inter-Regular.ttf"
          as="font"
          crossOrigin=""
        />
        <link
          rel="preload"
          href="/fonts/Inter/Inter-Bold.ttf"
          as="font"
          crossOrigin=""
        />
        <meta name="description" content="MinMax Finance DAO" />
        <meta name="og:title" content="MinMax Finance DAO" />
        <meta property="og:type" content="website" />
        <meta property="og:description"
          content="MinMax Finance DAO" />
        <meta property="og:image" content="https://vote.minmax.finance/minmaxlogo.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@minmaxfinance" />
        <meta name="twitter:title" content="MinMax Finance DAO" />
        <meta name="twitter:description" content="MinMax Finance DAO" />
        <meta name="twitter:image" content="https://vote.minmax.finance/minmaxlogo.png" />
      </Head>
      <div className={classes.content}>
        <SnackbarController />
        <main>{children}</main>
      </div>
    </div>
  );
}
