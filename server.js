const express = require('express');
const puppeteer = require('puppeteer');
const markdownIt = require('markdown-it');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Puppeteer configuration for Cloud Run
const getPuppeteerConfig = () => ({
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
  headless: 'new',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
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

    const md = markdownIt({ html: true, linkify: true, typographer: true });
    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 40px;
              max-width: 800px;
              margin: auto;
              line-height: 1.6;
            }
            h1, h2, h3, h4, h5, h6 {
              margin-top: 24px;
              margin-bottom: 12px;
            }
            p {
              margin-bottom: 12px;
            }
            pre {
              background: #f4f4f4;
              padding: 12px;
              border-radius: 4px;
              overflow-x: auto;
            }
            code {
              background: #f4f4f4;
              padding: 2px 6px;
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
    browser = await puppeteer.launch(getPuppeteerConfig());
    
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
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      timeout: 30000
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
console.log(`Puppeteer executable: ${process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'}`);

// Add startup delay to ensure all dependencies are ready
const startServer = async () => {
  try {
    console.log('Skipping Puppeteer test during startup for faster boot...');
    
    // Start server immediately
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ PDF API running on port ${PORT}`);
      console.log(`✅ Server is ready to accept connections`);
      console.log(`✅ Health check available at: http://0.0.0.0:${PORT}/health`);
    });

    server.on('error', (err) => {
      console.error('❌ Failed to start server:', err);
      process.exit(1);
    });

    // Test Puppeteer after server starts (async)
    setTimeout(async () => {
      try {
        console.log('Testing Puppeteer in background...');
        const browser = await puppeteer.launch(getPuppeteerConfig());
        await browser.close();
        console.log('✅ Puppeteer test successful');
      } catch (err) {
        console.error('⚠️  Puppeteer test failed:', err.message);
        console.error('PDF generation may not work properly');
      }
    }, 2000);

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
    console.error('❌ Server startup failed:', err);
    process.exit(1);
  }
};

startServer();