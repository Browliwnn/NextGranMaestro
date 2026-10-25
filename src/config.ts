// ============================================================
//  CONFIGURACIÓN CENTRAL — edita SOLO este archivo para datos reales
//  Todo lo marcado con [AÑADIR ...] debe sustituirse antes de publicar.
// ============================================================

// URL final de la web. Mientras no tengas dominio, usa la que te dé Cloudflare (xxxx.workers.dev).
export const SITE_URL = 'https://nextgranmaestro.forniteswap.workers.dev'; // [CAMBIAR por tu dominio real cuando lo compres]

export const SITE_NAME = 'NextGranMaestro';
export const SITE_TAGLINE = 'Analiza cualquier posición de ajedrez y descubre la mejor jugada';

// Planes de pago (enlaces de Stripe en MODO DE PRUEBAS: con ellos nadie paga de verdad; cámbialos por los reales para cobrar).
export const PLANS = {
  monthly: { price: '4,99 €', period: '/mes', priceNumber: '4.99', checkout: 'https://buy.stripe.com/test_dRm7sL1tgfE43qA0v3bZe00' as string | null },
  yearly: { price: '39,99 €', period: '/año', priceNumber: '39.99', checkout: 'https://buy.stripe.com/test_5kQ7sLc7U9fGe5e5PnbZe01' as string | null, note: 'Equivale a 3,33 €/mes · ahorras un 33 %' },
};

// Enlace al portal de cliente de Stripe (para que el usuario cancele o cambie su tarjeta). null = no se muestra.
export const PORTAL_URL: string | null = null; // [AÑADIR enlace del portal de cliente de Stripe]

// Testimonios: SOLO reales y con permiso de la persona. Mientras la lista esté vacía, la sección NO se muestra.
export const TESTIMONIALS: { name: string; detail?: string; text: string }[] = [];

// Análisis gratuitos por día en el plan gratis.
export const FREE_ANALYSES_PER_DAY = 20;

// Entrenamiento: niveles NUEVOS que se pueden superar cada día (los ya superados se pueden repetir siempre).
export const TRAINING = { freePerDay: 2, premiumPerDay: 10 };

// Partidas contra bots: pistas permitidas por partida.
export const BOT_HINTS = 3;

// Recuperar el plan por email: pon true SOLO cuando hayas configurado Resend (RESEND_API_KEY y MAIL_FROM en Cloudflare). Ver PAGOS.md.
export const EMAIL_RECOVERY = false;
/** true cuando hayas puesto PRICE_MONTHLY y PRICE_YEARLY en el Worker (ver PAGOS.md, sección G): el pago se crea en el servidor y exige cuenta. */
export const SERVER_CHECKOUT = false;

// Analítica sin cookies (Cloudflare Web Analytics): pega aquí el token de tu sitio (no es secreto) o déjalo en null. Ver README.md.
export const ANALYTICS_TOKEN: string | null = null;

// Atención al cliente: canal de soporte en Discord (invitación https://discord.gg/<código>)
export const SUPPORT_URL = 'https://discord.gg/cAFnyKjzgk';

// Contacto
export const CONTACT_EMAIL: string | null = 'forniteswap@gmail.com';

// Datos legales del titular (obligatorios en España para el Aviso Legal si hay actividad económica)
export const LEGAL = {
  owner: '[AÑADIR NOMBRE O RAZÓN SOCIAL]',
  taxId: '[AÑADIR NIF/CIF]',
  address: '[AÑADIR DOMICILIO]',
  email: 'forniteswap@gmail.com',
  updated: '21 de octubre de 2026',
};

export const NAV = [
  { href: '/analizador', label: 'Analizador' },
  { href: '/entrenamiento', label: 'Entrenamiento' },
  { href: '/jugar', label: 'Jugar' },
  { href: '/online', label: 'Online' },
  { href: '/como-funciona', label: 'Cómo funciona' },
  { href: '/precios', label: 'Precios' },
  { href: '/faq', label: 'Preguntas' },
  { href: '/soporte', label: 'Soporte' },
];
