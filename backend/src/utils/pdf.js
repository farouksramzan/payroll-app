const { chromium } = require('playwright');

async function htmlToPdf(html) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({
      format: 'Letter',
      margin: { top: '0.45in', right: '0.45in', bottom: '0.45in', left: '0.45in' },
      printBackground: true,
    });
    return pdf;
  } finally {
    await page.close();
    await browser.close();
  }
}

module.exports = { htmlToPdf };
