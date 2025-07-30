const express = require('express');
const puppeteer = require('puppeteer');
const markdownIt = require('markdown-it');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Simplified Puppeteer configuration for Google Cloud Run
const getPuppeteerConfig = () => {
  if (process.env.NODE_ENV === 'production') {
    return {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-background-timer-throttling'
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

const PORT = process.env.PORT || 8080;

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
