// ============================================================
//  CONFIGURACIÓN CENTRAL — edita SOLO este archivo para datos reales
//  Todo lo marcado con [AÑADIR ...] debe sustituirse antes de publicar.
// ============================================================

// URL final de la web. Mientras no tengas dominio, usa la que te dé Cloudflare (xxxx.workers.dev).
export const SITE_URL = 'https://nextgranmaestro.forniteswap.workers.dev'; // [CAMBIAR por tu dominio real cuando lo compres]

export const SITE_NAME = 'NextGranMaestro';
export const SITE_TAGLINE = 'Analiza cualquier posición de ajedrez y descubre la mejor jugada';

// Planes de pago (enlaces de Stripe en MODO DE PRUEBAS).
export const PLANS = {
  monthly: { price: '4,99 €', period: '/mes', priceNumber: '4.99', checkout: 'https://buy.stripe.com/test_dRm7sL1tgfE43qA0v3bZe00' as string | null },
  yearly: { price: '39,99 €', period: '/año', priceNumber: '39.99', checkout: 'https://buy.stripe.com/test_5kQ7sLc7U9fGe5e5PnbZe01' as string | null, note: 'Equivale a 3,33 €/mes · ahorras un 33 %' },
};

// Enlace al portal de cliente de Stripe (para que el usuario cancele o cambie su tarjeta). null = no se muestra.
export const PORTAL_URL: string | null = null; // [AÑADIR enlace del portal de cliente de Stripe]

// Testimonios: SOLO reales y con permiso de la persona. Mientras la lista esté vacía, la sección NO se muestra.
export const TESTIMONIALS: { name: string; detail?: string; text: string }[] = [];

// Análisis gratuitos por día en el plan gratis.
export const FREE_ANALYSES_PER_DAY = 5;

// Contacto
export const CONTACT_EMAIL: string | null = 'forniteswap@gmail.com';

// Datos legales del titular (obligatorios en España para el Aviso Legal si hay actividad económica)
export const LEGAL = {
  owner: '[AÑADIR NOMBRE O RAZÓN SOCIAL]',
  taxId: '[AÑADIR NIF/CIF]',
  address: '[AÑADIR DOMICILIO]',
  email: 'forniteswap@gmail.com',
};

export const NAV = [
  { href: '/analizador', label: 'Analizador' },
  { href: '/como-funciona', label: 'Cómo funciona' },
  { href: '/precios', label: 'Precios' },
  { href: '/faq', label: 'Preguntas' },
];
