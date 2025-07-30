const express = require('express');
const puppeteer = require('puppeteer');
const markdownIt = require('markdown-it');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Function to find Chrome executable
const findChrome = () => {
  const possiblePaths = [
    '/opt/render/.cache/puppeteer/chrome/linux-*/chrome-linux*/chrome',
    process.env.PUPPETEER_EXECUTABLE_PATH,
  ];
  
  for (const chromePath of possiblePaths) {
    if (chromePath && fs.existsSync(chromePath)) {
      return chromePath;
    }
  }
  
  // Try to find it dynamically
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer';
  if (fs.existsSync(cacheDir)) {
    try {
      const chromeDir = fs.readdirSync(cacheDir).find(dir => dir.startsWith('chrome'));
      if (chromeDir) {
        const chromePath = path.join(cacheDir, chromeDir);
        const linuxDir = fs.readdirSync(chromePath).find(dir => dir.startsWith('linux-'));
        if (linuxDir) {
          const chromeLinuxPath = path.join(chromePath, linuxDir);
          const chromeExecutable = fs.readdirSync(chromeLinuxPath).find(dir => dir.startsWith('chrome-linux'));
          if (chromeExecutable) {
            return path.join(chromeLinuxPath, chromeExecutable, 'chrome');
          }
        }
      }
    } catch (err) {
      console.error('Error finding Chrome executable:', err);
    }
  }
  
  return undefined;
};

// Puppeteer configuration for server environments
const getPuppeteerConfig = () => {
  if (process.env.NODE_ENV === 'production') {
    const executablePath = findChrome();
    console.log('Chrome executable path:', executablePath);
    
    return {
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ],
      headless: 'new'
    };
  }
  return { args: ['--no-sandbox'] };
};

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
    
    console.log('Setting content...');
    await page.setContent(html, { waitUntil: 'networkidle0' });

    console.log('Generating PDF...');
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' }
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
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'PDF Generation API',
    endpoints: {
      'POST /generate-pdf': 'Generate PDF from markdown',
      'GET /health': 'Health check'
    }
  });
});

const PORT = process.env.PORT || 3000;

// Add error handling for server startup
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
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
