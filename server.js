const express = require('express');
const { chromium } = require('playwright');
const markdownIt = require('markdown-it');
const cors = require('cors');

const app = express();

// CORS configuration - allow only specific domains
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://app.brushly.art',
      'https://dev--brushly.netlify.app'
    ];
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

// Playwright configuration for Cloud Run
const getPlaywrightConfig = () => ({
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-web-security',
    '--disable-features=TranslateUI',
    '--disable-default-apps',
    '--disable-extensions',
    '--hide-scrollbars',
    '--mute-audio',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-translate',
    '--disable-ipc-flooding-protection',
  ],
  headless: true,
});

app.post('/generate-pdf', async (req, res) => {
  let browser;
  try {
    let { markdown, filename = 'generated.pdf' } = req.body;

    if (!markdown) {
      return res.status(400).json({ error: 'Markdown is required' });
    }

    // Strip frontmatter if present
    markdown = markdown.replace(/^---[\s\S]*?---\s*/, '');

    const md = markdownIt({ 
      html: true, 
      linkify: true, 
      typographer: true,
      breaks: true
    });
    
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Generated PDF</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              padding: 40px;
              max-width: 800px;
              margin: auto;
              line-height: 1.6;
              color: #333;
              background: white;
            }
            h1, h2, h3, h4, h5, h6 {
              margin-top: 24px;
              margin-bottom: 12px;
              color: #2c3e50;
              font-weight: 600;
            }
            h1 { font-size: 2em; border-bottom: 2px solid #eee; padding-bottom: 8px; }
            h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 6px; }
            h3 { font-size: 1.25em; }
            h4 { font-size: 1.1em; }
            p {
              margin-bottom: 12px;
            }
            pre {
              background: #f8f9fa;
              padding: 16px;
              border-radius: 6px;
              overflow-x: auto;
              border: 1px solid #e9ecef;
              margin: 16px 0;
            }
            code {
              background: #f8f9fa;
              padding: 2px 6px;
              border-radius: 3px;
              font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
              font-size: 0.9em;
            }
            pre code {
              background: none;
              padding: 0;
              border-radius: 0;
            }
            blockquote {
              border-left: 4px solid #ddd;
              margin: 16px 0;
              padding-left: 16px;
              color: #666;
            }
            table {
              border-collapse: collapse;
              width: 100%;
              margin: 16px 0;
            }
            th, td {
              border: 1px solid #ddd;
              padding: 8px 12px;
              text-align: left;
            }
            th {
              background-color: #f8f9fa;
              font-weight: 600;
            }
            ul, ol {
              margin: 16px 0;
              padding-left: 24px;
            }
            li {
              margin: 4px 0;
            }
            a {
              color: #007bff;
              text-decoration: none;
            }
            a:hover {
              text-decoration: underline;
            }
            hr {
              border: none;
              border-top: 1px solid #eee;
              margin: 24px 0;
            }
            img {
              max-width: 100%;
              height: auto;
              border-radius: 4px;
            }
            .highlight {
              background: #fff3cd;
              padding: 2px 4px;
              border-radius: 3px;
            }
          </style>
        </head>
        <body>
          ${md.render(markdown)}
        </body>
      </html>
    `;

    console.log('Launching browser...');
    
    browser = await chromium.launch(getPlaywrightConfig());
    console.log('Browser launched successfully');
    
    console.log('Creating new page...');
    const page = await browser.newPage();
    
    // Set longer timeout for Cloud Run
    page.setDefaultTimeout(30000);
    
    console.log('Setting content...');
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('Generating PDF...');
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '9mm', bottom: '9mm', left: '10mm', right: '10mm' },
      preferCSSPageSize: true
    });

    await browser.close();
    console.log('PDF generated successfully');

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length
    });

    res.send(buffer);
  } catch (err) {
    console.error('Error generating PDF:', err);
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error('Error closing browser:', closeErr);
      }
    }
    res.status(500).json({ 
      error: 'Failed to generate PDF', 
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'PDF Generation API',
    status: 'running',
    port: PORT,
    endpoints: {
      'POST /generate-pdf': 'Generate PDF from markdown',
      'GET /health': 'Health check'
    }
  });
});

const PORT = process.env.PORT || 8080;

console.log(`Starting PDF API server...`);
console.log(`Port: ${PORT}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Playwright browsers path: ${process.env.PLAYWRIGHT_BROWSERS_PATH || 'default'}`);
console.log(`Chrome executable: ${process.env.CHROME_BIN || 'Playwright bundled'}`);

// Debug: List browser cache directory
const fs = require('fs');
const path = require('path');
try {
  const browserPath = process.env.PLAYWRIGHT_BROWSERS_PATH || '/app/.cache/ms-playwright';
  console.log(`Checking browser path: ${browserPath}`);
  if (fs.existsSync(browserPath)) {
    const files = fs.readdirSync(browserPath);
    console.log(`Browser cache contents: ${files.join(', ')}`);
  } else {
    console.log('Browser cache directory does not exist');
  }
} catch (err) {
  console.log(`Error checking browser cache: ${err.message}`);
}

// Add startup delay to ensure all dependencies are ready
const startServer = async () => {
  try {
    // Test Playwright before starting server
    console.log('Testing Playwright...');
    console.log('Launching browser for test...');
    
    browser = await chromium.launch(getPlaywrightConfig());
    console.log('Browser launched successfully');
    
    await browser.close();
    console.log('✅ Playwright test successful');
    
    // Start server
    console.log('Starting Express server...');
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ PDF API running on port ${PORT}`);
      console.log(`✅ Server is ready to accept connections`);
    });

    server.on('error', (err) => {
      console.error('❌ Failed to start server:', err);
      process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
      });
    });

  } catch (err) {
    console.error('❌ Playwright test failed:', err);
    console.error('Error details:', err.message);
    console.error('This usually means Chromium is not properly installed');
    process.exit(1);
  }
};

startServer();