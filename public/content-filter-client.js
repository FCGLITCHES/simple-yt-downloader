/**
 * Client-side content filter for blocked URL detection.
 * This file is loaded as a global before script.js runs.
 * Must stay in sync with backend/shared/content-filter.js.
 */
window.contentFilter_isBlockedUrl = function (url) {
  if (!url) return { blocked: false };

  try {
    var urlObj = new URL(url);
    var hostname = urlObj.hostname.toLowerCase();
    var pathname = urlObj.pathname.toLowerCase();

    var pornDomains = [
      "pornhub.com",
      "xvideos.com",
      "xhamster.com",
      "xnxx.com",
      "redtube.com",
      "youporn.com",
      "tube8.com",
      "spankwire.com",
      "keezmovies.com",
      "extremetube.com",
      "drtuber.com",
      "sunporno.com",
      "4tube.com",
      "livejasmin.com",
      "chaturbate.com",
      "myfreecams.com",
      "stripchat.com",
      "bongacams.com",
      "cam4.com",
      "camsoda.com",
      "streamate.com",
      "flirt4free.com",
      "onlyfans.com",
      "justfor.fans",
      "manyvids.com",
      "clips4sale.com",
    ];

    var pornKeywords = [
      ".porn",
      ".xxx",
      ".adult",
      ".sex",
      ".nude",
      ".erotic",
      ".milf",
      ".hentai",
      ".jav",
      ".camgirl",
      ".webcam",
    ];

    var gamblingDomains = [
      "bet365.com",
      "betway.com",
      "betfair.com",
      "paddypower.com",
      "williamhill.com",
      "ladbrokes.com",
      "coral.co.uk",
      "betvictor.com",
      "unibet.com",
      "betsson.com",
      "betonline.ag",
      "bovada.lv",
      "pokerstars.com",
      "partypoker.com",
      "fulltilt.com",
      "bwin.com",
      "888.com",
      "casino.com",
      "vegas.com",
      "borgata.com",
      "caesars.com",
      "mgmresorts.com",
      "wynn.com",
      "draftkings.com",
      "fanduel.com",
    ];

    var gamblingKeywords = [
      ".casino",
      ".poker",
      ".bet",
      ".gambling",
      ".lottery",
      ".jackpot",
      ".sportsbook",
      ".bookmaker",
      ".betting",
      ".wager",
    ];

    for (var i = 0; i < pornDomains.length; i++) {
      if (
        hostname === pornDomains[i] ||
        hostname.endsWith("." + pornDomains[i])
      ) {
        return { blocked: true, reason: "pornography" };
      }
    }

    for (var i = 0; i < gamblingDomains.length; i++) {
      if (
        hostname === gamblingDomains[i] ||
        hostname.endsWith("." + gamblingDomains[i])
      ) {
        return { blocked: true, reason: "gambling" };
      }
    }

    for (var i = 0; i < pornKeywords.length; i++) {
      if (hostname.indexOf(pornKeywords[i]) !== -1) {
        return { blocked: true, reason: "pornography" };
      }
    }

    for (var i = 0; i < gamblingKeywords.length; i++) {
      if (hostname.indexOf(gamblingKeywords[i]) !== -1) {
        return { blocked: true, reason: "gambling" };
      }
    }

    var explicitPatterns = [
      "/porn/",
      "/xxx/",
      "/adult/",
      "/sex/",
      "/nude/",
      "/naked/",
      "/erotic/",
      "/mature/",
      "/milf/",
      "/teen/",
      "/anal/",
      "/lesbian/",
      "/gay/",
      "/bdsm/",
      "/fetish/",
      "/hentai/",
      "/jav/",
      "/camgirl/",
      "/webcam/",
      "/livejasmin/",
      "/chaturbate/",
      "/myfreecams/",
      "/stripchat/",
      "/bongacams/",
      "/cam4/",
      "/camsoda/",
      "/streamate/",
      "/flirt4free/",
      "/onlyfans/",
      "/justfor.fans/",
      "/manyvids/",
      "/clips4sale/",
    ];

    var gamblingPatterns = [
      "/casino/",
      "/poker/",
      "/slot/",
      "/roulette/",
      "/blackjack/",
      "/baccarat/",
      "/craps/",
      "/sportsbook/",
      "/bookmaker/",
      "/betting/",
      "/wager/",
      "/gambling/",
      "/pokerstars/",
      "/partypoker/",
      "/fulltilt/",
      "/bwin/",
      "/bet365/",
      "/betway/",
      "/betfair/",
      "/paddypower/",
      "/williamhill/",
      "/ladbrokes/",
      "/coral/",
      "/betvictor/",
      "/unibet/",
      "/betsson/",
      "/betonline/",
      "/bovada/",
      "/jackpot/",
      "/lottery/",
      "/scratch/",
      "/vegas/",
      "/atlantic/",
      "/borgata/",
      "/caesars/",
      "/mgm/",
      "/wynn/",
      "/draftkings/",
      "/fanduel/",
    ];

    for (var i = 0; i < explicitPatterns.length; i++) {
      if (pathname.indexOf(explicitPatterns[i]) !== -1) {
        return { blocked: true, reason: "pornography" };
      }
    }

    for (var i = 0; i < gamblingPatterns.length; i++) {
      if (pathname.indexOf(gamblingPatterns[i]) !== -1) {
        return { blocked: true, reason: "gambling" };
      }
    }
  } catch (e) {
    var urlLower = url.toLowerCase();
    var strictPornDomains = [
      "pornhub",
      "xvideos",
      "xhamster",
      "xnxx",
      "redtube",
      "youporn",
    ];
    var strictGamblingDomains = [
      "bet365",
      "betway",
      "betfair",
      "paddypower",
      "williamhill",
      "ladbrokes",
      "pokerstars",
    ];

    for (var i = 0; i < strictPornDomains.length; i++) {
      if (
        urlLower.indexOf(strictPornDomains[i] + ".com") !== -1 ||
        urlLower.indexOf(strictPornDomains[i] + ".net") !== -1
      ) {
        return { blocked: true, reason: "pornography" };
      }
    }

    for (var i = 0; i < strictGamblingDomains.length; i++) {
      if (
        urlLower.indexOf(strictGamblingDomains[i] + ".com") !== -1 ||
        urlLower.indexOf(strictGamblingDomains[i] + ".net") !== -1 ||
        urlLower.indexOf(strictGamblingDomains[i] + ".co.uk") !== -1
      ) {
        return { blocked: true, reason: "gambling" };
      }
    }
  }

  return { blocked: false };
};
