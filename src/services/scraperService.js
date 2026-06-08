const path = require('path');
const fs = require('fs');
const os = require('os');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const Influencer = require('../models/Influencer');

if (!global.__PET_LEADS_STEALTH_PLUGIN_REGISTERED__) {
  puppeteer.use(StealthPlugin());
  global.__PET_LEADS_STEALTH_PLUGIN_REGISTERED__ = true;
}

if (global.__PET_LEADS_SCRAPER_RUNNING__ === undefined) {
  global.__PET_LEADS_SCRAPER_RUNNING__ = false;
}

if (global.__PET_LEADS_STOP_REQUESTED__ === undefined) {
  global.__PET_LEADS_STOP_REQUESTED__ = false;
}

const randomDelay = (min = 800, max = 2000) => {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
};

const requestStop = () => {
  global.__PET_LEADS_STOP_REQUESTED__ = true;
};

const clearStopRequest = () => {
  global.__PET_LEADS_STOP_REQUESTED__ = false;
};

const ensureNotStopped = () => {
  if (global.__PET_LEADS_STOP_REQUESTED__) {
    throw new Error('Busca interrompida pelo usuario.');
  }
};

const normalizeText = value => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

const isManualChallengePage = async page => {
  const hasChallengeFrame = page.frames().some(frame => {
    const frameUrl = frame.url().toLowerCase();
    return (
      frameUrl.includes('recaptcha') ||
      frameUrl.includes('captcha') ||
      frameUrl.includes('/challenge/')
    );
  });

  if (hasChallengeFrame) return true;

  return page.evaluate(() => {
    const text = (document.body.innerText || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const hasCaptchaElement = Boolean(
      document.querySelector(
        'iframe[src*="recaptcha"], iframe[src*="captcha"], iframe[title*="reCAPTCHA"], iframe[title*="captcha"], div[class*="captcha"], div[id*="captcha"]'
      )
    );

    return (
      hasCaptchaElement ||
      window.location.href.includes('/challenge/') ||
      window.location.href.includes('/checkpoint/') ||
      text.includes('insira o codigo') ||
      text.includes('digite o codigo') ||
      text.includes('confirmar que e voce') ||
      text.includes('confirme que e voce') ||
      text.includes('atividade suspeita') ||
      text.includes("i'm not a robot") ||
      text.includes('im not a robot') ||
      text.includes('nao sou um robo') ||
      text.includes('nao sou robo') ||
      text.includes('captcha') ||
      text.includes('recaptcha') ||
      text.includes('security check') ||
      text.includes('verificacao de seguranca') ||
      text.includes('challenge') ||
      text.includes('enter the code') ||
      text.includes('confirm it is you') ||
      text.includes('confirm that it is you') ||
      text.includes('suspicious activity')
    );
  }).catch(() => false);
};

const waitForManualChallengeResolution = async (page, options = {}) => {
  const { requireLoggedIn = false } = options;
  const challengeDetected = await isManualChallengePage(page);

  if (!challengeDetected) return;

  console.log('\nInstagram pediu verificacao manual.');
  console.log('Resolva o codigo/captcha no navegador aberto.');
  console.log('Nao navegue manualmente para outra pagina. Complete a verificacao nessa tela.');
  console.log('O robo vai aguardar ate a conta estar pronta para continuar...\n');

  const startedAt = Date.now();
  const timeoutMs = 15 * 60 * 1000;

  while (Date.now() - startedAt < timeoutMs) {
    await randomDelay(2000, 3500);

    const stillInChallenge = await isManualChallengePage(page);
    const loggedIn = await isLoggedIn(page);

    if (requireLoggedIn && loggedIn) {
      console.log('Verificacao manual resolvida e login confirmado. Continuando...');
      await randomDelay(2000, 4000);
      return;
    }

    if (!requireLoggedIn && !stillInChallenge) {
      console.log('Verificacao manual resolvida. Continuando...');
      await randomDelay(2000, 4000);
      return;
    }

    if (requireLoggedIn && !stillInChallenge) {
      console.log('Verificacao saiu da tela, mas o login ainda nao foi confirmado. Finalize o login no navegador aberto...');
    }
  }

  throw new Error('Tempo limite aguardando resolucao manual do captcha/codigo.');
};

const parseSocialNumber = value => {
  if (!value) return 0;

  const normalized = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s/g, '');

  const hasMillionSuffix = /\d+(?:[.,]\d+)?(?:mi|m)\b/.test(normalized);
  const hasThousandSuffix = /\d+(?:[.,]\d+)?(?:mil|k)\b/.test(normalized);
  const numericPart = normalized.match(/\d+(?:[.,]\d+)*/)?.[0];

  if (!numericPart) return 0;

  if (hasMillionSuffix || hasThousandSuffix) {
    const decimalNumber = parseFloat(numericPart.replace(',', '.'));
    if (Number.isNaN(decimalNumber)) return 0;

    return Math.round(decimalNumber * (hasMillionSuffix ? 1000000 : 1000));
  }

  const digitsOnly = numericPart.replace(/[.,]/g, '');
  const number = Number.parseInt(digitsOnly, 10);

  return Number.isNaN(number) ? 0 : number;
};

const getUnique = values => [...new Set(values.filter(Boolean))];

const LINK_TYPE_OPTIONS = {
  linktree: ['linktr.ee', 'linktree.com', 'beacons.ai', 'bio.site', 'taplink.cc', 'campsite.bio'],
  whatsapp: ['wa.me', 'api.whatsapp.com', 'whatsapp.com', 'w.app'],
  threads: ['threads.net'],
  facebook: ['facebook.com', 'fb.com'],
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  youtube: ['youtube.com', 'youtu.be'],
  other: []
};

const classifyLinkType = link => {
  const normalizedLink = normalizeText(link);

  for (const [type, patterns] of Object.entries(LINK_TYPE_OPTIONS)) {
    if (type === 'other') continue;
    if (patterns.some(pattern => normalizedLink.includes(pattern))) {
      return type;
    }
  }

  return 'other';
};

const filterLinksByType = (links, allowedLinkTypes = []) => {
  if (!allowedLinkTypes || allowedLinkTypes.length === 0) return links;

  const allowed = new Set(allowedLinkTypes);
  return links.filter(link => allowed.has(classifyLinkType(link)));
};

const getSessionDir = () => {
  const configuredDir = process.env.PUPPETEER_SESSION_DIR || process.env.CHROME_PROFILE_DIR;

  if (configuredDir) {
    return path.resolve(configuredDir);
  }

  const baseDir = process.env.LOCALAPPDATA || os.tmpdir();
  return path.join(baseDir, 'pet-leads-scraper', 'chrome-profile');
};

const launchBrowser = async () => {
  const userDataDir = getSessionDir();
  fs.mkdirSync(userDataDir, { recursive: true });

  console.log(`Abrindo navegador com perfil persistente: ${userDataDir}`);

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir,
    defaultViewport: null,
    protocolTimeout: 120000,
    args: [
      '--lang=pt-BR,pt',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=site-per-process',
      '--window-size=1366,900'
    ]
  });

  const browserProcess = browser.process();

  if (browserProcess) {
    browserProcess.once('exit', (code, signal) => {
      console.error(`Processo do navegador encerrou. code=${code} signal=${signal}`);
    });
  }

  browser.on('disconnected', () => {
    console.error('Navegador desconectou do Puppeteer.');
  });

  return browser;
};

const getStablePage = async browser => {
  let page;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await randomDelay(1200, 2200);
      if (!browser.isConnected()) {
        throw new Error('Navegador ja desconectou antes de abrir uma aba.');
      }
      page = await browser.newPage();
      break;
    } catch (error) {
      console.error(`Erro ao abrir nova aba (tentativa ${attempt}/3):`, error.message);

      if (attempt === 3) {
        throw error;
      }

      await randomDelay(2000, 3500);
    }
  }

  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(30000);

  page.on('error', error => {
    console.error('Erro na pagina do navegador:', error.message);
  });

  page.on('pageerror', error => {
    console.error('Erro executado na pagina:', error.message);
  });

  return page;
};

const profileMatchesNiche = ({ username, bio, niche }) => {
  if (!niche || niche === 'all') return true;

  const text = normalizeText(`${username} ${bio}`);
  const keywords = {
    cats: [
      'gato',
      'gata',
      'gatos',
      'gatas',
      'gatinho',
      'gatinha',
      'gatinhos',
      'gatinhas',
      'felino',
      'felina',
      'felinos',
      'felinas',
      'cat',
      'cats',
      'kitty',
      'meow',
      'miau',
      'ronron'
    ],
    dogs: [
      'cachorro',
      'cachorra',
      'cachorros',
      'cachorras',
      'cao',
      'cão',
      'cães',
      'dog',
      'dogs',
      'puppy',
      'canino',
      'canina',
      'caninos',
      'caninas',
      'viralata',
      'caramelo'
    ]
  };

  return (keywords[niche] || []).some(keyword => text.includes(keyword));
};

const extractProfileData = async page => {
  return page.evaluate(() => {
    const pageText = document.body.innerText || '';
    const normalizedPageText = pageText
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const hasPrivateProfileText =
      normalizedPageText.includes('este perfil e privado') ||
      normalizedPageText.includes('esta conta e privada') ||
      normalizedPageText.includes('this account is private');

    const hasPrivateProfileHint =
      normalizedPageText.includes('siga esse usuario para ver suas fotos e videos') ||
      normalizedPageText.includes('follow this account to see their photos and videos');

    const hasPrivateLockIcon = Boolean(
      document.querySelector(
        'svg path[d*="M60.931 70.001H35.065"], svg path[d*="37.999 39.996v-6.998"]'
      )
    );

    const isPrivate =
      hasPrivateProfileText ||
      (hasPrivateProfileHint && hasPrivateLockIcon);

    if (isPrivate) {
      return {
        isPrivate: true,
        followersText: '',
        bio: '',
        contacts: { emails: [], phones: [], links: [] }
      };
    }

    const metaDescription = document.querySelector('meta[name="description"]');
    const metaContent = metaDescription ? metaDescription.getAttribute('content') || '' : '';
    const followersMatch = metaContent.match(/([\d.,]+\s?(?:mil|mi|k|m)?)\s*(?:Followers|seguidores)/i);

    const header = document.querySelector('header');
    const rawText = header ? header.innerText : pageText;

    const officialLinks = [];
    const dynamicLinks = Array.from(document.querySelectorAll('header a[href*="l.instagram.com/?u="]'));

    dynamicLinks.forEach(link => {
      const rawHref = link.getAttribute('href');
      if (!rawHref) return;

      try {
        const params = new URLSearchParams(rawHref.split('?')[1]);
        const decodedUrl = params.get('u');
        if (decodedUrl) officialLinks.push(decodedUrl);
      } catch {
        const match = rawHref.match(/[\?&]u=([^&]+)/);
        if (match && match[1]) officialLinks.push(decodeURIComponent(match[1]));
      }
    });

    if (officialLinks.length === 0) {
      const fallbackLinks = Array.from(document.querySelectorAll('header a'))
        .map(link => link.href)
        .filter(href => href && !href.includes('instagram.com') && !href.startsWith('/'));

      officialLinks.push(...fallbackLinks);
    }

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const phoneRegex = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\d{4}[-\s]?\d{4}|\d{4}[-\s]?\d{4})/g;
    const linkRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;

    return {
      isPrivate: false,
      followersText: followersMatch ? followersMatch[1] : '',
      bio: rawText.replace(/\n+/g, ' | ').trim(),
      contacts: {
        emails: rawText.match(emailRegex) || [],
        phones: rawText.match(phoneRegex) || [],
        links: [...officialLinks, ...(rawText.match(linkRegex) || [])]
      }
    };
  });
};

const isLoggedIn = async page => {
  return page.evaluate(() => {
    const loggedInSelectors = [
      'a[href="/direct/inbox/"]',
      'a[href*="/direct/inbox"]',
      'a[href="/accounts/edit/"]',
      'a[href*="/accounts/edit"]',
      'svg[aria-label="Página inicial"]',
      'svg[aria-label="Home"]',
      'svg[aria-label="Nova publicação"]',
      'svg[aria-label="New post"]'
    ];

    return loggedInSelectors.some(selector => document.querySelector(selector));
  }).catch(() => false);
};

const login = async page => {
  const userSelector = 'input[name="username"], input[name="email"]';
  const passSelector = 'input[name="password"], input[name="pass"]';

  console.log('Verificando sessao do Instagram...');
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
  await randomDelay(2500, 4500);
  await waitForManualChallengeResolution(page, { requireLoggedIn: true });

  if (await isLoggedIn(page)) {
    console.log('Sessao ja esta ativa. Pulando login.');
    return;
  }

  if (!process.env.IG_USERNAME || !process.env.IG_PASSWORD) {
    throw new Error('IG_USERNAME e IG_PASSWORD precisam estar definidos no .env quando nao houver sessao ativa.');
  }

  let existingLoginInput = await page.$(userSelector);

  if (!existingLoginInput) {
    console.log('Acessando login do Instagram...');
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle2' });
    await waitForManualChallengeResolution(page);
    existingLoginInput = await page.$(userSelector);
  } else {
    console.log('Formulario de login ja esta aberto.');
  }

  await page.waitForSelector(userSelector, { visible: true, timeout: 15000 });
  await page.type(userSelector, process.env.IG_USERNAME, { delay: 100 });

  await page.waitForSelector(passSelector, { visible: true, timeout: 15000 });
  await page.type(passSelector, process.env.IG_PASSWORD, { delay: 100 });

  await randomDelay(500, 1000);
  await page.keyboard.press('Enter');

  console.log('Aguardando autenticacao...');
  await randomDelay(3000, 5000);
  await waitForManualChallengeResolution(page, { requireLoggedIn: true });

  if (!(await isLoggedIn(page))) {
    await page.waitForFunction(() => {
      const loggedInSelectors = [
        'a[href="/direct/inbox/"]',
        'a[href*="/direct/inbox"]',
        'a[href="/accounts/edit/"]',
        'a[href*="/accounts/edit"]',
        'svg[aria-label="Página inicial"]',
        'svg[aria-label="Home"]',
        'svg[aria-label="Nova publicação"]',
        'svg[aria-label="New post"]'
      ];

      return loggedInSelectors.some(selector => document.querySelector(selector));
    }, { timeout: 60000 }).catch(() => {});
  }

  if (!(await isLoggedIn(page))) {
    throw new Error('Login nao foi confirmado. Resolva qualquer captcha/codigo aberto e rode novamente.');
  }
};

const collectPostLinks = async (page, targetProfile, maxPosts) => {
  console.log(`Acessando perfil base: @${targetProfile}`);
  await page.goto(`https://www.instagram.com/${targetProfile}/`, { waitUntil: 'domcontentloaded' });
  await waitForManualChallengeResolution(page);
  await page.waitForSelector('a[href*="/p/"], a[href*="/reel/"]', { timeout: 15000 });
  await randomDelay();

  const postLinks = await page.evaluate(limit => {
    const links = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
    return [...new Set(links.map(link => link.href))].slice(0, limit);
  }, maxPosts);

  console.log(`Encontrados ${postLinks.length} posts para analisar.`);
  return postLinks;
};

const scrollFollowersDialog = async page => {
  return page.evaluate(() => {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return { target: 'not-found', count: 0 };

    const candidates = Array.from(dialog.querySelectorAll('div'))
      .filter(element => element.scrollHeight > element.clientHeight + 80)
      .map(element => {
        const profileLinks = Array.from(element.querySelectorAll('a[href^="/"]'))
          .filter(link => /^\/[A-Za-z0-9._]+\/$/.test(link.getAttribute('href') || ''))
          .length;

        return {
          element,
          score: profileLinks * 30 + Math.min(element.scrollHeight - element.clientHeight, 3000)
        };
      })
      .sort((a, b) => b.score - a.score);

    const container = candidates[0]?.element;
    if (!container) return { target: 'not-found', count: 0 };

    container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
    container.dispatchEvent(new Event('scroll', { bubbles: true }));

    return {
      target: 'followers-dialog',
      count: Array.from(dialog.querySelectorAll('a[href^="/"]'))
        .filter(link => /^\/[A-Za-z0-9._]+\/$/.test(link.getAttribute('href') || ''))
        .length
    };
  });
};

const collectFollowers = async (page, targetProfile, followerScanLimit) => {
  console.log(`Acessando seguidores do perfil base: @${targetProfile}`);
  await page.goto(`https://www.instagram.com/${targetProfile}/`, { waitUntil: 'domcontentloaded' });
  await waitForManualChallengeResolution(page);
  await page.waitForSelector('header', { timeout: 15000 });
  await randomDelay();

  const clicked = await page.evaluate(() => {
    const normalize = value => String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const header = document.querySelector('header');
    if (!header) return false;

    const candidates = Array.from(header.querySelectorAll('a, span[role="link"], div[role="button"]'));
    const followerElement = candidates.find(element => {
      const href = element.getAttribute('href') || '';
      const text = normalize(element.innerText || element.textContent || '');

      return href.includes('/followers') ||
        text.includes('seguidores') ||
        text.includes('followers');
    });

    const clickable = followerElement?.closest('a, div[role="button"], span[role="link"]');
    if (!clickable) return false;

    clickable.click();
    return true;
  });

  if (!clicked) {
    console.log('Nao foi possivel abrir a lista de seguidores.');
    return [];
  }

  await page.waitForSelector('div[role="dialog"]', { timeout: 15000 });
  await randomDelay(1500, 2500);

  const followers = new Set();
  let stalledRounds = 0;
  let previousCount = 0;

  while (followers.size < followerScanLimit && stalledRounds < 8) {
    ensureNotStopped();

    const batch = await page.evaluate(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return [];

      return Array.from(dialog.querySelectorAll('a[href^="/"]'))
        .map(link => link.getAttribute('href'))
        .filter(href => /^\/[A-Za-z0-9._]+\/$/.test(href || ''))
        .map(href => href.replaceAll('/', ''));
    });

    batch.forEach(username => followers.add(username));

    if (followers.size === previousCount) {
      stalledRounds += 1;
    } else {
      stalledRounds = 0;
      previousCount = followers.size;
    }

    const scrollResult = await scrollFollowersDialog(page);
    console.log(`   Seguidores carregados: ${followers.size}/${followerScanLimit} (${scrollResult.target})`);
    await randomDelay(1500, 2600);
  }

  await page.keyboard.press('Escape').catch(() => {});
  await randomDelay(800, 1400);

  return Array.from(followers).slice(0, followerScanLimit);
};

const scrollCommentsSection = async page => {
  return page.evaluate(() => {
    const profileLinkRegex = /^\/[A-Za-z0-9._]+\/$/;

    const getProfileLinkCount = element => {
      return Array.from(element.querySelectorAll('a[href^="/"]'))
        .filter(link => profileLinkRegex.test(link.getAttribute('href') || ''))
        .length;
    };

    const candidates = Array.from(document.querySelectorAll('article div, main div, div[role="dialog"] div'))
      .map(element => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const canScroll = element.scrollHeight > element.clientHeight + 80;
        const isVisible = rect.width > 250 && rect.height > 180 && rect.bottom > 0 && rect.top < window.innerHeight;
        const profileLinkCount = getProfileLinkCount(element);

        return {
          element,
          score:
            (canScroll ? 1000 : 0) +
            profileLinkCount * 20 +
            Math.min(element.scrollHeight - element.clientHeight, 2000) +
            (style.overflowY === 'auto' || style.overflowY === 'scroll' ? 500 : 0),
          canScroll,
          isVisible,
          profileLinkCount
        };
      })
      .filter(candidate => candidate.canScroll && candidate.isVisible && candidate.profileLinkCount >= 2)
      .sort((a, b) => b.score - a.score);

    const commentsContainer = candidates[0]?.element;

    if (commentsContainer) {
      commentsContainer.scrollTo({
        top: commentsContainer.scrollHeight,
        behavior: 'instant'
      });

      commentsContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
      return {
        scrolled: true,
        target: 'comments-container',
        scrollTop: commentsContainer.scrollTop,
        scrollHeight: commentsContainer.scrollHeight,
        clientHeight: commentsContainer.clientHeight,
        profileLinkCount: candidates[0].profileLinkCount
      };
    }

    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
    const loadMoreButton = buttons.find(button => {
      const text = button.innerText || button.getAttribute('aria-label') || '';
      return /ver todos os comentarios|ver mais comentarios|carregar mais comentarios|view all comments|load more comments/i.test(text);
    });

    if (loadMoreButton) {
      loadMoreButton.click();
      return { scrolled: true, target: 'load-more-button' };
    }

    return { scrolled: false, target: 'not-found' };
  });
};

const collectCommenters = async (page, postLinks) => {
  const potentialLeads = new Set();

  for (const link of postLinks) {
    ensureNotStopped();

    console.log(`Analisando comentarios: ${link}`);
    await page.goto(link, { waitUntil: 'domcontentloaded' });
    await waitForManualChallengeResolution(page);
    await page.waitForSelector('article, main', { timeout: 15000 });
    await randomDelay();

    for (let i = 0; i < 3; i += 1) {
      ensureNotStopped();
      const scrollResult = await scrollCommentsSection(page);
      console.log(`   Rolagem ${i + 1}: ${scrollResult.target}`);

      await randomDelay(1800, 2800);
    }

    const commenters = await page.evaluate(() => {
      const ignoreList = ['p', 'reel', 'explore', 'stories', 'accounts'];
      return Array.from(document.querySelectorAll('main a, article a'))
        .map(link => link.getAttribute('href'))
        .filter(href => href && href.startsWith('/') && href.split('/').length === 3)
        .map(href => href.replaceAll('/', ''))
        .filter(username => username && !ignoreList.includes(username));
    });

    commenters.forEach(username => potentialLeads.add(username));
  }

  return Array.from(potentialLeads);
};

const runScraper = async (targetProfile, options = {}) => {
  if (global.__PET_LEADS_SCRAPER_RUNNING__) {
    throw new Error('Ja existe uma busca em andamento. Aguarde ela terminar antes de iniciar outra.');
  }

  global.__PET_LEADS_SCRAPER_RUNNING__ = true;
  clearStopRequest();

  const maxBrandPosts = Number(options.maxBrandPosts || process.env.MAX_BRAND_POSTS || 5);
  const maxLeadsPerRun = Number(options.maxLeadsPerRun || process.env.MAX_LEADS_PER_RUN || 50);
  const sourceMode = options.sourceMode || process.env.SOURCE_MODE || 'comments';
  const followerScanLimit = Number(options.followerScanLimit || process.env.FOLLOWER_SCAN_LIMIT || 10000);
  const minFollowers = Number(options.minFollowers || process.env.MIN_FOLLOWERS || 200);
  const maxFollowers = Number(options.maxFollowers || process.env.MAX_FOLLOWERS || 5000);
  const requireAnyContact =
    options.requireAnyContact !== undefined
      ? Boolean(options.requireAnyContact)
      : process.env.REQUIRE_ANY_CONTACT !== 'false';
  const requireLink =
    options.requireLink !== undefined
      ? Boolean(options.requireLink)
      : process.env.REQUIRE_LINK === 'true';
  const niche = options.niche || process.env.NICHE || 'all';
  const allowedLinkTypes = Array.isArray(options.allowedLinkTypes)
    ? options.allowedLinkTypes
    : String(process.env.ALLOWED_LINK_TYPES || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);

  console.log(`Iniciando agente scraper. Alvo principal: @${targetProfile}`);

  let browser;
  const qualifiedLeads = [];

  try {
    browser = await launchBrowser();
    const page = await getStablePage(browser);

    await login(page);

    const potentialLeads = new Set();

    if (sourceMode === 'comments' || sourceMode === 'both') {
      ensureNotStopped();
      const postLinks = await collectPostLinks(page, targetProfile, maxBrandPosts);
      const commenters = await collectCommenters(page, postLinks);
      commenters.forEach(username => potentialLeads.add(username));
    }

    if (sourceMode === 'followers' || sourceMode === 'both') {
      ensureNotStopped();
      const followers = await collectFollowers(page, targetProfile, followerScanLimit);
      followers.forEach(username => potentialLeads.add(username));
    }

    const leadsArray = getUnique(Array.from(potentialLeads))
      .filter(username => username !== targetProfile)
      .slice(0, maxLeadsPerRun);

    console.log(`Foram separados ${leadsArray.length} perfis unicos nos comentarios.`);

    const existingInfluencers = await Influencer.find({ username: { $in: leadsArray } }).select('username');
    const existingUsernames = new Set(existingInfluencers.map(item => item.username));
    const leadsToScrape = leadsArray.filter(username => !existingUsernames.has(username));

    console.log(`Ignorados ${existingUsernames.size} perfis ja conhecidos.`);
    console.log(`Restaram ${leadsToScrape.length} perfis ineditos para visitar.`);

    for (const lead of leadsToScrape) {
      ensureNotStopped();

      console.log(`\nAvaliando @${lead}`);
      await page.goto(`https://www.instagram.com/${lead}/`, { waitUntil: 'domcontentloaded' });
      await waitForManualChallengeResolution(page);
      await page.waitForSelector('header, meta[name="description"]', { timeout: 10000 }).catch(() => {});
      await randomDelay(1000, 2000);

      const profile = await extractProfileData(page);
      const followers = parseSocialNumber(profile.followersText);

      if (profile.isPrivate) {
        console.log('Descartado: conta privada.');
        continue;
      }

      console.log(`Seguidores: ${followers}`);

      if (followers < minFollowers || followers > maxFollowers) {
        console.log('Descartado: fora da faixa de seguidores.');
        continue;
      }

      if (!profileMatchesNiche({ username: lead, bio: profile.bio, niche })) {
        console.log(`Descartado: perfil nao corresponde ao nicho selecionado (${niche}).`);
        continue;
      }

      const contacts = {
        emails: getUnique(profile.contacts.emails),
        phones: getUnique(profile.contacts.phones),
        links: filterLinksByType(getUnique(profile.contacts.links), allowedLinkTypes)
      };

      const hasAnyContact =
        contacts.emails.length > 0 ||
        contacts.phones.length > 0 ||
        contacts.links.length > 0;

      if (requireAnyContact && !hasAnyContact) {
        console.log('Descartado: perfil sem e-mail, telefone ou link na bio.');
        continue;
      }

      if (requireLink && contacts.links.length === 0) {
        console.log('Descartado: perfil sem link na bio.');
        continue;
      }

      console.log('Qualificado. Adicionando a lista.');
      qualifiedLeads.push({
        username: lead,
        followers,
        bio: profile.bio,
        contacts,
        sourceBrand: targetProfile
      });

      await randomDelay(1000, 2000);
    }

    return qualifiedLeads;
  } catch (error) {
    console.error('Erro durante a raspagem:', error.message);

    if (options.failOnError && qualifiedLeads.length === 0) {
      throw error;
    }

    return qualifiedLeads;
  } finally {
    global.__PET_LEADS_SCRAPER_RUNNING__ = false;

    if (browser) {
      console.log('Fechando navegador...');
      await browser.close().catch(error => {
        console.error('Erro ao fechar navegador:', error.message);
      });
    }
  }
};

module.exports = { runScraper };
module.exports.requestStop = requestStop;
