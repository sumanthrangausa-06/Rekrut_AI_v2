/**
 * Domain Validator Service
 *
 * Validates email domains for recruiter registration.
 * Handles company domain extraction, lookup, and enforcement.
 * Merged from email-domain-validator.js and company-domain-service.js.
 */

const pool = require('../lib/db');

// Comprehensive list of free/disposable/temporary email domains
const BLOCKED_EMAIL_DOMAINS = new Set([
	// Major free providers
	'gmail.com',
	'yahoo.com',
	'hotmail.com',
	'outlook.com',
	'live.com',
	'msn.com',
	'aol.com',
	'icloud.com',
	'me.com',
	'mac.com',
	'protonmail.com',
	'proton.me',
	'zoho.com',
	'yandex.com',
	'yandex.ru',
	'mail.com',
	'gmx.com',
	'gmx.net',
	'gmx.de',
	'inbox.com',
	'qq.com',
	'163.com',
	'126.com',
	'sina.com',
	'sohu.com',
	'tom.com',
	'139.com',
	'189.cn',
	'aliyun.com',
	'foxmail.com',
	'yeah.net',

	// Disposable/temporary providers
	'mailinator.com',
	'guerrillamail.com',
	'tempmail.com',
	'temp-mail.org',
	'throwawaymail.com',
	'fakeinbox.com',
	'sharklasers.com',
	'getairmail.com',
	'yopmail.com',
	'yopmail.fr',
	'yopmail.net',
	'cool.fr.nf',
	'jetable.fr.nf',
	'nospam.ze.tc',
	'nomail.xl.cx',
	'mega.zik.dj',
	'speed.1s.fr',
	'courriel.fr.nf',
	'moncourrier.fr.nf',
	'monemail.fr.nf',
	'mailtmp.com',
	'tempinbox.com',
	'tempmailaddress.com',
	'burnermail.io',
	'burner.kiwi',
	'tempail.com',
	'tmpmail.org',
	'disposableemail.com',
	'disposable-mail.com',
	'tempmailo.com',
	'tempmail.plus',
	'mailnesia.com',
	'mailcatch.com',
	'mohmal.com',
	'mohmal.in',
	'mohmal.im',
	'mail-temp.com',
	'tempmails.io',
	'emailondeck.com',
	'getnada.com',
	'inboxkitten.com',
	'temp-mail.io',
	'fakemail.net',
	'trashmail.com',
	'trashmail.se',
	'trashmail.me',
	'trashmail.de',
	'trashmail.at',
	'trashmail.org',
	'mytrashmail.com',
	'mailforspam.com',
	'spamgourmet.com',
	'boun.cr',
	'anonaddy.me',
	'addy.io',
	'simplelogin.com',
	'simplelogin.co',
	'duck.com',
	'mozmail.com',
	'relay.firefox.com',
	'maildrop.cc',
	'harakirimail.com',
	'mailfreeonline.com',
	'spambog.com',
	'spambog.de',
	'spambog.ru',
	'discard.email',
	'discardmail.com',
	'discardmail.de',
	'0-mail.com',
	'0815.ru',
	'0wnd.net',
	'0wnd.org',
	'10minutemail.com',
	'20minutemail.com',
	'24hourmail.com',
	'2prong.com',
	'3d-painting.com',
	'4warding.com',
	'4warding.net',
	'4warding.org',
	'60minutemail.com',
	'675hosting.com',
	'675hosting.net',
	'675hosting.org',
	'6paq.com',
	'75hosting.com',
	'75hosting.net',
	'75hosting.org',
	'9ox.net',
	'a-bc.net',
	'afrobacon.com',
	'ajaxapp.net',
	'amilegit.com',
	'amiri.net',
	'amiriindustries.com',
	'anonbox.net',
	'anonymbox.com',
	'antichef.com',
	'antichef.net',
	'antispam.de',
	'baxomale.ht.cx',
	'beefmilk.com',
	'binkmail.com',
	'bio-muesli.info',
	'bio-muesli.net',
	'bobmail.info',
	'bodhi.lawlita.com',
	'bofthew.com',
	'bootybay.de',
	'brefmail.com',
	'bsnow.net',
	'bspamfree.org',
	'bugmenot.com',
	'bumpymail.com',
	'casualdx.com',
	'chogmail.com',
	'coolhoops.com',
	'correo.blogos.com',
	'cosmorph.com',
	'courrieltemporaire.com',
	'cubiclink.com',
	'curryworld.de',
	'cust.in',
	'dacoolest.com',
	'dandikmail.com',
	'dayrep.com',
	'deadaddress.com',
	'deadspam.com',
	'despam.it',
	'despammed.com',
	'devnullmail.com',
	'dfgh.net',
	'digitalsanctuary.com',
	'dodgeit.com',
	'dodgit.com',
	'dodgit.org',
	'donemail.ru',
	'dontreg.com',
	'dontsendmespam.de',
	'drdrb.com',
	'drdrb.net',
	'dump-email.info',
	'dumpandjunk.com',
	'dumpmail.de',
	'dumpyemail.com',
	'e4ward.com',
	'email60.com',
	'emaildienst.de',
	'emailgo.de',
	'emailias.com',
	'emaillime.com',
	'emailproxsy.com',
	'emailtemporanea.com',
	'emailtemporanea.net',
	'emailtemporar.ro',
	'emailtemporario.com.br',
	'emailthe.net',
	'emailtmp.com',
	'emailto.de',
	'emailwarden.com',
	'emailx.at.hm',
	'emailxfer.com',
	'emz.net',
	'enterto.com',
	'ephemail.net',
	'etranquil.com',
	'etranquil.net',
	'etranquil.org',
	'explodemail.com',
	'express.net.ua',
	'eyepaste.com',
	'fake-box.com',
	'fakeinformation.com',
	'fansworldwide.de',
	'fantasymail.de',
	'fastacura.com',
	'fastchevy.com',
	'fastchrysler.com',
	'fastkawasaki.com',
	'fastmazda.com',
	'fastmitsubishi.com',
	'fastnissan.com',
	'fastsubaru.com',
	'fastsuzuki.com',
	'fasttoyota.com',
	'fastyamaha.com',
	'fightallspam.com',
	'filzmail.com',
	'fivemail.de',
	'fizmail.com',
	'fleckens.hu',
	'frapmail.com',
	'friendlymail.co.uk',
	'fuckingduh.com',
	'fudgerub.com',
	'fyii.de',
	'garliclife.com',
	'gehensiemirnichtaufdensack.de',
	'get2mail.fr',
	'getonemail.com',
	'getonemail.net',
	'ghosttexter.de',
	'girlsundertheinfluence.com',
	'gishpuppy.com',
	'gowikibooks.com',
	'gowikicampus.com',
	'gowikicars.com',
	'gowikifilms.com',
	'gowikigames.com',
	'gowikimusic.com',
	'gowikinetwork.com',
	'gowikitravel.com',
	'gowikitv.com',
	'great-host.in',
	'greensloth.com',
	'gsrv.co.uk',
	'guerillamail.biz',
	'guerillamail.com',
	'guerillamail.de',
	'guerillamail.net',
	'guerillamail.org',
	'guerrillamail.biz',
	'guerrillamail.de',
	'guerrillamail.info',
	'guerrillamail.net',
	'guerrillamail.org',
	'guerrillamailblock.com',
	'h.mintemail.com',
	'h8s.org',
	'haltospam.com',
	'hat-geld.de',
	'hatespam.org',
	'hidemail.de',
	'hochsitze.com',
	'hotpop.com',
	'hulapla.de',
	'ieatspam.eu',
	'ieatspam.info',
	'ihateyoualot.info',
	'iheartspam.org',
	'imails.info',
	'inbox.si',
	'inboxalias.com',
	'inboxclean.com',
	'inboxclean.org',
	'incognitomail.com',
	'incognitomail.net',
	'ipoo.org',
	'irish2me.com',
	'iwi.net',
	'jsrsolutions.com',
	'junk1e.com',
	'kasmail.com',
	'kaspop.com',
	'keepmymail.com',
	'killmail.com',
	'killmail.net',
	'kir.ch.tc',
	'klassmaster.com',
	'klassmaster.net',
	'klzlk.com',
	'kulturbetrieb.info',
	'kurzepost.de',
	'letthemeatspam.com',
	'lhsdv.com',
	'lifebyfood.com',
	'link2mail.net',
	'litedrop.com',
	'lr7.us',
	'lr78.com',
	'lroid.com',
	'lukop.dk',
	'm21.cc',
	'mail-filter.com',
	'mail-temporaire.com',
	'mail-temporaire.fr',
	'mail.by',
	'mail.mezimages.net',
	'mail.zp.ua',
	'mail1a.de',
	'mail21.cc',
	'mail2rss.org',
	'mail333.com',
	'mail4trash.com',
	'mailbidon.com',
	'mailbiz.biz',
	'mailblocks.com',
	'mailbucket.org',
	'mailcat.biz',
	'mailcatch.com',
	'mailde.de',
	'mailde.info',
	'maildrop.cc',
	'maildx.com',
	'maileater.com',
	'mailexpire.com',
	'mailfa.tk',
	'mailforspam.com',
	'mailfreeonline.com',
	'mailguard.me',
	'mailin8r.com',
	'mailinater.com',
	'mailincubator.com',
	'mailismagic.com',
	'mailmate.com',
	'mailme.dk',
	'mailme.ir',
	'mailme.lv',
	'mailmetrash.com',
	'mailmoat.com',
	'mailnator.com',
	'mailnesia.com',
	'mailnull.com',
	'mailshell.com',
	'mailsiphon.com',
	'mailslite.com',
	'mailtome.de',
	'mailtothis.com',
	'mailtrash.net',
	'mailtv.net',
	'mailtv.tv',
	'mailzilla.com',
	'mailzilla.org',
	'makemetheking.com',
	'mbx.cc',
	'mega.zik.dj',
	'meltmail.com',
	'messagebeamer.de',
	'mierdamail.com',
	'mintemail.com',
	'moncourrier.fr.nf',
	'monemail.fr.nf',
	'monmail.fr.nf',
	'msa.minsmail.com',
	'mt2009.com',
	'mx0.wwwnew.eu',
	'mycleaninbox.net',
	'mymail-in.net',
	'mypartyclip.de',
	'myphantomemail.com',
	'myspaceinc.com',
	'myspaceinc.net',
	'myspaceinc.org',
	'myspacepimpedup.com',
	'myspamless.com',
	'mytrashmail.com',
	'neomailbox.com',
	'nepwk.com',
	'nervmich.net',
	'nervtmich.net',
	'netmails.com',
	'netmails.net',
	'netzidiot.de',
	'neverbox.com',
	'nice-4u.com',
	'nigge.rs',
	'nomail.xl.cx',
	'nomail2me.com',
	'nomorespamemails.com',
	'nospam.ze.tc',
	'nospam4.us',
	'nospamfor.us',
	'nospamthanks.info',
	'notmailinator.com',
	'nowmymail.com',
	'nurfuerspam.de',
	'nus.edu.sg',
	'nwldx.com',
	'objectmail.com',
	'obobbo.com',
	'oneoffemail.com',
	'onewaymail.com',
	'online.ms',
	'oopi.org',
	'ordinaryamerican.net',
	'otherinbox.com',
	'ovpn.to',
	'owlpic.com',
	'pancakemail.com',
	'pcusers.otherinbox.com',
	'pepbot.com',
	'poczta.onet.pl',
	'politikerclub.de',
	'pookmail.com',
	'privacy.net',
	'proxymail.eu',
	'prtnx.com',
	'punkass.com',
	'putthisinyourspamdatabase.com',
	'quickinbox.com',
	'rcpt.at',
	'reallymymail.com',
	'recode.me',
	'recursor.net',
	'regbypass.com',
	'regbypass.comsafe-mail.net',
	'rhyta.com',
	'rklipsmail.com',
	'rmqkr.net',
	'royal.net',
	'rppkn.com',
	'rtrtr.com',
	's0ny.net',
	'safe-mail.net',
	'safersignup.de',
	'safetymail.info',
	'safetypost.de',
	'sandelf.de',
	'saynotospams.com',
	'schafmail.de',
	'schrott-email.de',
	'secretemail.de',
	'secure-mail.biz',
	'selfdestructingmail.com',
	'sendspamhere.com',
	'senseless-entertainment.com',
	'shiftmail.com',
	'shitmail.me',
	'shitmail.org',
	'shortmail.net',
	'skeefmail.com',
	'slaskpost.se',
	'slopsbox.com',
	'smashmail.de',
	'smellfear.com',
	'snakemail.com',
	'sneakemail.com',
	'sofimail.com',
	'sofort-mail.de',
	'sogetthis.com',
	'soodonims.com',
	'spam.la',
	'spam.su',
	'spam4.me',
	'spamavert.com',
	'spambob.com',
	'spambob.net',
	'spambob.org',
	'spambog.com',
	'spambog.de',
	'spambog.ru',
	'spambox.info',
	'spambox.irishspringrealty.com',
	'spambox.us',
	'spamcannon.com',
	'spamcannon.net',
	'spamcon.org',
	'spamcorptastic.com',
	'spamcowboy.com',
	'spamcowboy.net',
	'spamcowboy.org',
	'spamday.com',
	'spamex.com',
	'spamfree.eu',
	'spamfree24.com',
	'spamfree24.de',
	'spamfree24.eu',
	'spamfree24.info',
	'spamfree24.net',
	'spamfree24.org',
	'spamgoes.in',
	'spamgourmet.com',
	'spamgourmet.net',
	'spamgourmet.org',
	'spamherelots.com',
	'spamhereplease.com',
	'spamhole.com',
	'spamify.com',
	'spaminator.de',
	'spamkill.info',
	'spaml.com',
	'spaml.de',
	'spammotel.com',
	'spamobox.com',
	'spamoff.de',
	'spamsalad.in',
	'spamslicer.com',
	'spamspot.com',
	'spamstack.net',
	'spamthis.co.uk',
	'spamthisplease.com',
	'spamtrail.com',
	'spamtroll.net',
	'speed.1s.fr',
	'spoofmail.de',
	'stuffmail.de',
	'super-auswahl.de',
	'supergreatmail.com',
	'supermailer.jp',
	'superrito.com',
	'superstachel.de',
	'suremail.info',
	'tagyourself.com',
	'teewars.org',
	'teleworm.com',
	'teleworm.us',
	'temp-mail.ru',
	'temp-emails.com',
	'tempail.com',
	'tempalias.com',
	'tempe-mail.com',
	'tempemail.biz',
	'tempemail.co.za',
	'tempemail.com',
	'tempemail.net',
	'tempinbox.co.uk',
	'tempinbox.com',
	'tempmail.it',
	'tempmail.ws',
	'tempmail2.com',
	'tempmaildemo.com',
	'tempmailer.com',
	'tempmailer.de',
	'tempomail.fr',
	'temporarily.de',
	'temporarioemail.com.br',
	'temporaryemail.net',
	'temporaryemail.us',
	'temporaryforwarding.com',
	'temporaryinbox.com',
	'temporarymailaddress.com',
	'tempthe.net',
	'thanksnospam.info',
	'thankyou2010.com',
	'thisisnotmyrealemail.com',
	'thnid.com',
	'throwawayemailaddress.com',
	'tilien.com',
	'tmail.com',
	'tmail.ws',
	'tmailinator.com',
	'toomail.biz',
	'tradermail.info',
	'trash-amil.com',
	'trash-mail.at',
	'trash-mail.cf',
	'trash-mail.com',
	'trash-mail.de',
	'trash-mail.ga',
	'trash-mail.gq',
	'trash-mail.ml',
	'trash-mail.tk',
	'trash2009.com',
	'trashdevil.com',
	'trashdevil.de',
	'trashemail.de',
	'trashmail.at',
	'trashmail.com',
	'trashmail.de',
	'trashmail.me',
	'trashmail.net',
	'trashmail.org',
	'trashmail.ws',
	'trashmailer.com',
	'trashymail.com',
	'trashymail.net',
	'trialmail.de',
	'trillianpro.com',
	'twinmail.de',
	'tyldd.com',
	'uggsrock.com',
	'upliftnow.com',
	'uplipht.com',
	'venompen.com',
	'veryrealemail.com',
	'viditag.com',
	'viewcastmedia.com',
	'viewcastmedia.net',
	'viewcastmedia.org',
	'webm4il.info',
	'wegwerfadresse.de',
	'wegwerfemail.com',
	'wegwerfemail.de',
	'wegwerfmail.de',
	'wegwerfmail.info',
	'wegwerfmail.net',
	'wegwerfmail.org',
	'wh4f.org',
	'whyspam.me',
	'willhackforfood.biz',
	'winemaven.info',
	'wronghead.com',
	'wuzup.net',
	'wuzupmail.net',
	'www.e4ward.com',
	'www.gishpuppy.com',
	'www.mailinator.com',
	'wwwnew.eu',
	'xagloo.com',
	'xemaps.com',
	'xents.com',
	'xmaily.com',
	'xoxy.net',
	'yep.it',
	'yogamaven.com',
	'yopmail.com',
	'yopmail.fr',
	'yopmail.net',
	'yuurok.com',
	'z1p.biz',
	'za.com',
	'zehnminutenmail.de',
	'zippymail.info',
	'zoaxe.com',
	'zoemail.com',
	'zomg.info',

	// Common ISP-provided emails
	'verizon.net',
	'att.net',
	'comcast.net',
	'cox.net',
	'sbcglobal.net',
	'bellsouth.net',
	'earthlink.net',
	'optonline.net',
	'juno.com',
	'netzero.net',
	'frontier.com',
	'rcn.com',
	' charter.net',
	'xfinity.com',

	// Student/university (often free, not company)
	'edu.com',
	'student.com',

	// Other common free
	'tutanota.com',
	'tutanota.de',
	'keemail.me',
	'mail.ru',
	'bk.ru',
	'list.ru',
	'inbox.ru',
	'internet.ru',
	'xmail.ru',
	'outlook.co.uk',
	'outlook.fr',
	'outlook.de',
	'live.co.uk',
	'live.fr',
	'live.de',
	'hotmail.co.uk',
	'hotmail.fr',
	'hotmail.de',
	'msn.co.uk',
	'rocketmail.com',
	'ymail.com',
	'fastmail.com',
	'fastmail.fm',
	'runbox.com',
	'posteo.de',
	'posteo.net',
	'mailbox.org',
	'hushmail.com',
	'hush.ai',
	'startmail.com',
	'countermail.com',
	'scryptmail.com',
]);

// Known recruitment agency domains - these should be allowed but flagged
const RECRUITMENT_AGENCY_DOMAINS = new Set([
	'randstad.com',
	'adecco.com',
	'manpower.com',
	'kellyservices.com',
	'roberthalf.com',
	'hays.com',
	'michaelpage.com',
	'modis.com',
	'teksystems.com',
	'allegisgroup.com',
	'kforce.com',
	'insightglobal.com',
	'collabera.com',
	'cybercoders.com',
	'dice.com',
	'indeed.com',
	'glassdoor.com',
	'linkedin.com',
	'monster.com',
	'careerbuilder.com',
	'ziprecruiter.com',
	'simplyhired.com',
	'snagajob.com',
	'flexjobs.com',
	'staffing.com',
	'recruiting.com',
	'talent.com',
]);

// Known public email subdomains that might slip through
const BLOCKED_SUBDOMAIN_PATTERNS = [
	/^mail\./,
	/^email\./,
	/^webmail\./,
	/^smtp\./,
	/^pop\./,
	/^imap\./,
];

/**
 * Extract and normalize domain from an email address.
 * @param {string} email
 * @returns {string|null}
 */
function extractDomain(email) {
	if (!email || typeof email !== 'string') return null;
	const parts = email.trim().toLowerCase().split('@');
	if (parts.length !== 2) return null;
	return parts[1];
}

/**
 * Normalize a domain for comparison.
 * Handles subdomains by extracting the root domain for well-known TLDs.
 * @param {string} domain
 * @returns {string|null}
 */
function normalizeDomain(domain) {
	if (!domain) return null;
	domain = domain.trim().toLowerCase();

	domain = domain.replace(/^www\./, '');

	const parts = domain.split('.');

	for (let i = 0; i < parts.length - 1; i++) {
		const testDomain = parts.slice(i).join('.');
		if (BLOCKED_EMAIL_DOMAINS.has(testDomain)) {
			return testDomain;
		}
	}

	if (parts.length > 2) {
		const tld = parts[parts.length - 1];
		const commonTlds = ['com', 'org', 'net', 'io', 'co', 'ai', 'app', 'dev', 'tech'];
		const secondLevel = parts[parts.length - 2];
		const ccTlds = ['uk', 'au', 'jp', 'nz', 'br', 'in', 'sg', 'hk'];
		if (ccTlds.includes(tld) && secondLevel === 'co') {
			return parts.slice(-3).join('.');
		}
		if (commonTlds.includes(tld)) {
			return parts.slice(-2).join('.');
		}
	}

	return domain;
}

/**
 * Check if an email domain is blocked (free/disposable).
 * @param {string} email
 * @returns {{blocked: boolean, domain: string|null, reason: string|null}}
 */
function isBlockedEmailDomain(email) {
	const domain = extractDomain(email);
	if (!domain) {
		return { blocked: true, domain: null, reason: 'Invalid email format' };
	}

	if (BLOCKED_EMAIL_DOMAINS.has(domain)) {
		return {
			blocked: true,
			domain,
			reason: `The domain "${domain}" is a personal/free email provider. Please use your company email address.`,
		};
	}

	const normalized = normalizeDomain(domain);
	if (normalized && normalized !== domain && BLOCKED_EMAIL_DOMAINS.has(normalized)) {
		return {
			blocked: true,
			domain: normalized,
			reason: `The domain "${domain}" resolves to a personal/free email provider ("${normalized}"). Please use your company email address.`,
		};
	}

	for (const pattern of BLOCKED_SUBDOMAIN_PATTERNS) {
		if (pattern.test(domain)) {
			const rootDomain = domain.split('.').slice(1).join('.');
			if (rootDomain && !BLOCKED_EMAIL_DOMAINS.has(rootDomain)) {
				// root domain not blocked, skip
			}
		}
	}

	return { blocked: false, domain, reason: null };
}

/**
 * Check if an email is a valid company email (not blocked).
 * @param {string} email
 * @returns {boolean}
 */
function isCompanyEmail(email) {
	const result = isBlockedEmailDomain(email);
	return !result.blocked;
}

/**
 * Check if a domain belongs to a known recruitment agency.
 * @param {string} domain
 * @returns {boolean}
 */
function isRecruitmentAgencyDomain(domain) {
	if (!domain) return false;
	const normalized = normalizeDomain(domain);
	return RECRUITMENT_AGENCY_DOMAINS.has(domain) || RECRUITMENT_AGENCY_DOMAINS.has(normalized);
}

/**
 * Validate an email for recruiter registration.
 * @param {string} email
 * @returns {{valid: boolean, domain: string|null, error: string|null, isAgency: boolean}}
 */
function validateRecruiterEmail(email) {
	const blockResult = isBlockedEmailDomain(email);

	if (blockResult.blocked) {
		return {
			valid: false,
			domain: blockResult.domain,
			error: blockResult.reason,
			isAgency: false,
		};
	}

	const domain = blockResult.domain;
	const isAgency = isRecruitmentAgencyDomain(domain);

	return {
		valid: true,
		domain,
		error: null,
		isAgency,
	};
}

/**
 * Get a user-friendly list of blocked domain examples for error messages.
 * @returns {string}
 */
function getBlockedDomainExamples() {
	return 'gmail.com, yahoo.com, outlook.com, hotmail.com, protonmail.com, mailinator.com, etc.';
}

// ─── Company Domain DB Functions ───────────────────────────────────────────

/**
 * Find a company by its verified domain.
 * @param {string} domain
 * @returns {Promise<object|null>}
 */
async function findCompanyByDomain(domain) {
	if (!domain) return null;

	const normalized = normalizeDomain(domain);

	let result = await pool.query(
		'SELECT * FROM companies WHERE verified_domain = $1 OR verified_domain = $2 LIMIT 1',
		[domain, normalized],
	);

	if (result.rows.length > 0) {
		return result.rows[0];
	}

	result = await pool.query(
		'SELECT * FROM companies WHERE email_domain = $1 OR email_domain = $2 LIMIT 1',
		[domain, normalized],
	);

	if (result.rows.length > 0) {
		return result.rows[0];
	}

	return null;
}

/**
 * Check if a domain already has an associated company.
 * @param {string} domain
 * @returns {Promise<boolean>}
 */
async function isDomainTaken(domain) {
	const company = await findCompanyByDomain(domain);
	return company !== null;
}

/**
 * Store a verified domain on a company record.
 * @param {number} companyId
 * @param {string} domain
 * @returns {Promise<void>}
 */
async function storeVerifiedDomain(companyId, domain) {
	if (!companyId || !domain) return;

	const normalized = normalizeDomain(domain);

	await pool.query(
		`UPDATE companies
     SET verified_domain = $1,
         email_domain = COALESCE(email_domain, $1),
         is_verified = true,
         verified_at = COALESCE(verified_at, NOW()),
         updated_at = NOW()
     WHERE id = $2`,
		[normalized, companyId],
	);
}

/**
 * Check if an email domain matches a company's verified domain.
 * @param {string} email
 * @param {string} companyDomain
 * @returns {boolean}
 */
function checkDomainMatch(email, companyDomain) {
	if (!email || !companyDomain) return false;

	const parts = email.trim().toLowerCase().split('@');
	if (parts.length !== 2) return false;

	const emailDomain = normalizeDomain(parts[1]);
	const verifiedDomain = normalizeDomain(companyDomain);

	return emailDomain === verifiedDomain;
}

/**
 * Get the company domain from a company record.
 * @param {object} company
 * @returns {string|null}
 */
function getCompanyDomain(company) {
	if (!company) return null;
	return company.verified_domain || company.email_domain || null;
}

/**
 * Create a pending join request for a recruiter wanting to join an existing company.
 * @param {number} userId
 * @param {number} companyId
 * @param {string} email
 * @param {string} domain
 * @returns {Promise<object>}
 */
async function createJoinRequest(userId, companyId, email, domain) {
	const result = await pool.query(
		`INSERT INTO recruiter_join_requests
     (user_id, company_id, email, domain, status, requested_at)
     VALUES ($1, $2, $3, $4, 'pending', NOW())
     RETURNING *`,
		[userId, companyId, email, normalizeDomain(domain)],
	);
	return result.rows[0];
}

/**
 * Find a pending join request for a user.
 * @param {number} userId
 * @returns {Promise<object|null>}
 */
async function findPendingJoinRequest(userId) {
	const result = await pool.query(
		`SELECT * FROM recruiter_join_requests
     WHERE user_id = $1 AND status = 'pending'
     ORDER BY requested_at DESC
     LIMIT 1`,
		[userId],
	);
	return result.rows[0] || null;
}

/**
 * Approve a join request.
 * @param {number} requestId
 * @param {number} approvedByUserId
 * @returns {Promise<object|null>}
 */
async function approveJoinRequest(requestId, approvedByUserId) {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		const requestResult = await client.query(
			'SELECT * FROM recruiter_join_requests WHERE id = $1',
			[requestId],
		);

		if (requestResult.rows.length === 0) {
			await client.query('ROLLBACK');
			return null;
		}

		const request = requestResult.rows[0];

		if (request.status !== 'pending') {
			await client.query('ROLLBACK');
			return null;
		}

		await client.query(
			`UPDATE recruiter_join_requests
       SET status = 'approved',
           approved_at = NOW(),
           approved_by = $1,
           updated_at = NOW()
       WHERE id = $2`,
			[approvedByUserId, requestId],
		);

		await client.query('UPDATE users SET company_id = $1, updated_at = NOW() WHERE id = $2', [
			request.company_id,
			request.user_id,
		]);

		await client.query('COMMIT');

		return { ...request, status: 'approved' };
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

/**
 * Reject a join request.
 * @param {number} requestId
 * @param {number} rejectedByUserId
 * @param {string} reason
 * @returns {Promise<object|null>}
 */
async function rejectJoinRequest(requestId, rejectedByUserId, reason = '') {
	const result = await pool.query(
		`UPDATE recruiter_join_requests
     SET status = 'rejected',
         rejected_at = NOW(),
         rejected_by = $1,
         rejection_reason = $2,
         updated_at = NOW()
     WHERE id = $3 AND status = 'pending'
     RETURNING *`,
		[rejectedByUserId, reason, requestId],
	);

	return result.rows[0] || null;
}

/**
 * List pending join requests for a company.
 * @param {number} companyId
 * @returns {Promise<Array>}
 */
async function listPendingJoinRequests(companyId) {
	const result = await pool.query(
		`SELECT rjr.*, u.name as user_name
     FROM recruiter_join_requests rjr
     JOIN users u ON rjr.user_id = u.id
     WHERE rjr.company_id = $1 AND rjr.status = 'pending'
     ORDER BY rjr.requested_at DESC`,
		[companyId],
	);
	return result.rows;
}

/**
 * Get join request by ID.
 * @param {number} requestId
 * @returns {Promise<object|null>}
 */
async function getJoinRequestById(requestId) {
	const result = await pool.query(
		`SELECT rjr.*, u.name as user_name, u.email as user_email
     FROM recruiter_join_requests rjr
     JOIN users u ON rjr.user_id = u.id
     WHERE rjr.id = $1`,
		[requestId],
	);
	return result.rows[0] || null;
}

/**
 * Find the latest join request for a user (any status).
 * @param {number} userId
 * @returns {Promise<object|null>}
 */
async function findLatestJoinRequestForUser(userId) {
	const result = await pool.query(
		`SELECT * FROM recruiter_join_requests
     WHERE user_id = $1
     ORDER BY requested_at DESC
     LIMIT 1`,
		[userId],
	);
	return result.rows[0] || null;
}

module.exports = {
	// Email domain validator exports
	BLOCKED_EMAIL_DOMAINS,
	RECRUITMENT_AGENCY_DOMAINS,
	extractDomain,
	normalizeDomain,
	isBlockedEmailDomain,
	isCompanyEmail,
	isRecruitmentAgencyDomain,
	validateRecruiterEmail,
	getBlockedDomainExamples,
	// Company domain service exports
	findCompanyByDomain,
	isDomainTaken,
	storeVerifiedDomain,
	checkDomainMatch,
	getCompanyDomain,
	createJoinRequest,
	findPendingJoinRequest,
	findLatestJoinRequestForUser,
	approveJoinRequest,
	rejectJoinRequest,
	listPendingJoinRequests,
	getJoinRequestById,
};
