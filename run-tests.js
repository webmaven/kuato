const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  await page.goto('file://' + path.resolve('extension/tests/test-runner.html'), {waitUntil: 'networkidle0'});

  await page.waitForSelector('#results');

  const results = await page.evaluate(() => {
    const summary = document.querySelector('h2').innerText;
    const testCases = Array.from(document.querySelectorAll('.test-case')).map(tc => tc.innerText);
    return { summary, testCases };
  });

  console.log('Test Summary:', results.summary);
  console.log('Test Cases:');
  results.testCases.forEach(tc => console.log(tc));

  await browser.close();

  if (results.summary.includes('failed')) {
    process.exit(1);
  }
})();
