"use strict";

/**
 * @module content-filter
 * Shared content filter for blocked URL detection.
 * Used by both server (Node.js) and client (via content-filter-client.js).
 */

/**
 * Check if a URL is blocked by the content filter.
 *
 * @param {string} url - The URL to check.
 * @returns {{ blocked: boolean, reason?: string }} Result indicating whether the URL is blocked and why.
 */
function contentFilter_isBlockedUrl(url) {
  if (!url) return { blocked: false };

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname.toLowerCase();

    // Pornography site domains and patterns
    const pornDomains = [
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

    // Pornography keywords in domain (more specific)
    const pornKeywords = [
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

    // Gambling site domains and patterns
    const gamblingDomains = [
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

    // Gambling keywords in domain (more specific)
    const gamblingKeywords = [
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

    // Check domain matches
    for (const domain of pornDomains) {
      if (hostname === domain || hostname.endsWith("." + domain)) {
        return { blocked: true, reason: "pornography" };
      }
    }

    for (const domain of gamblingDomains) {
      if (hostname === domain || hostname.endsWith("." + domain)) {
        return { blocked: true, reason: "gambling" };
      }
    }

    // Check for keywords in domain
    for (const keyword of pornKeywords) {
      if (hostname.includes(keyword)) {
        return { blocked: true, reason: "pornography" };
      }
    }

    for (const keyword of gamblingKeywords) {
      if (hostname.includes(keyword)) {
        return { blocked: true, reason: "gambling" };
      }
    }

    // Check for explicit patterns in path (more restrictive)
    const explicitPatterns = [
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

    const gamblingPatterns = [
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

    // Check path patterns (only if in path, not in query params)
    for (const pattern of explicitPatterns) {
      if (pathname.includes(pattern)) {
        return { blocked: true, reason: "pornography" };
      }
    }

    for (const pattern of gamblingPatterns) {
      if (pathname.includes(pattern)) {
        return { blocked: true, reason: "gambling" };
      }
    }
  } catch (e) {
    // If URL parsing fails, do basic string check as fallback
    const urlLower = url.toLowerCase();
    const strictPornDomains = [
      "pornhub",
      "xvideos",
      "xhamster",
      "xnxx",
      "redtube",
      "youporn",
    ];
    const strictGamblingDomains = [
      "bet365",
      "betway",
      "betfair",
      "paddypower",
      "williamhill",
      "ladbrokes",
      "pokerstars",
    ];

    for (const domain of strictPornDomains) {
      if (
        urlLower.includes(domain + ".com") ||
        urlLower.includes(domain + ".net")
      ) {
        return { blocked: true, reason: "pornography" };
      }
    }

    for (const domain of strictGamblingDomains) {
      if (
        urlLower.includes(domain + ".com") ||
        urlLower.includes(domain + ".net") ||
        urlLower.includes(domain + ".co.uk")
      ) {
        return { blocked: true, reason: "gambling" };
      }
    }
  }

  return { blocked: false };
}

module.exports = { contentFilter_isBlockedUrl };
