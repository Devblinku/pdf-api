const express = require('express');
const PDFDocument = require('pdfkit');
const markdownIt = require('markdown-it');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Convert markdown to plain text with basic formatting
function markdownToPDF(doc, markdown) {
  const md = markdownIt();
  const tokens = md.parse(markdown, {});
  
  let currentY = doc.y;
  
  tokens.forEach(token => {
    switch (token.type) {
      case 'heading_open':
        const level = parseInt(token.tag.slice(1));
        const fontSize = Math.max(24 - (level * 2), 12);
        doc.fontSize(fontSize).font('Helvetica-Bold');
        currentY += 10;
        break;
        
      case 'heading_close':
        currentY += 10;
        doc.font('Helvetica').fontSize(12);
        break;
        
      case 'paragraph_open':
        currentY += 5;
        break;
        
      case 'paragraph_close':
        currentY += 10;
        break;
        
      case 'inline':
        if (token.content) {
          // Handle inline formatting
          let text = token.content;
          
          // Bold text **text**
          text = text.replace(/\*\*(.*?)\*\*/g, (match, content) => {
            doc.font('Helvetica-Bold').text(content, { continued: true });
            doc.font('Helvetica');
            return '';
          });
          
          // Italic text *text*
          text = text.replace(/\*(.*?)\*/g, (match, content) => {
            doc.font('Helvetica-Oblique').text(content, { continued: true });
            doc.font('Helvetica');
            return '';
          });
          
          // Code `code`
          text = text.replace(/`(.*?)`/g, (match, content) => {
            doc.font('Courier').text(content, { continued: true });
            doc.font('Helvetica');
            return '';
          });
          
          if (text.trim()) {
            doc.text(text);
          }
        }
        break;
        
      case 'code_block':
      case 'fence':
        if (token.content) {
          currentY += 10;
          doc.rect(doc.x - 10, doc.y - 5, 500, token.content.split('\n').length * 15 + 10)
             .fill('#f4f4f4')
             .stroke('#ddd');
          doc.fillColor('#000')
             .font('Courier')
             .fontSize(10)
             .text(token.content, doc.x, doc.y);
          doc.font('Helvetica').fontSize(12);
          currentY += 15;
        }
        break;
        
      case 'bullet_list_open':
        currentY += 5;
        break;
        
      case 'list_item_open':
        doc.text('• ', { continued: true, indent: 20 });
        break;
        
      case 'list_item_close':
        currentY += 5;
        break;
        
      case 'hr':
        currentY += 10;
        doc.moveTo(50, doc.y)
           .lineTo(550, doc.y)
           .stroke('#ccc');
        currentY += 10;
        break;
    }
  });
}

app.post('/generate-pdf', async (req, res) => {
  try {
    let { markdown, filename = 'generated.pdf' } = req.body;

    if (!markdown) {
      return res.status(400).json({ error: 'Markdown is required' });
    }

    // Strip frontmatter if present
    if (/^---\n/.test(markdown)) {
        markdown = markdown.replace(/^---[\s\S]*?---\s*/, '');
      }
      
    console.log('Generating PDF with PDFKit...');

    // Create a new PDF document
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4'
    });

    // Collect PDF data
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const buffer = Buffer.concat(chunks);
      
      console.log('PDF generated successfully');

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length
      });

      res.send(buffer);
    });

    // Add title
    doc.fontSize(20)
       .font('Helvetica-Bold')
       .text('Generated Document', { align: 'center' });
    
    doc.moveDown(2);

    // Convert markdown to PDF
    markdownToPDF(doc, markdown);

    // Finalize the PDF
    doc.end();

  } catch (err) {
    console.error('Error generating PDF:', err);
    res.status(500).json({ 
      error: 'Failed to generate PDF', 
      message: err.message
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
    message: 'PDF Generation API with PDFKit',
    status: 'running',
    port: PORT,
    endpoints: {
      'POST /generate-pdf': 'Generate PDF from markdown',
      'GET /health': 'Health check'
    }
  });
});

const PORT = process.env.PORT || 8080;

console.log(`Starting PDF API server with PDFKit on port ${PORT}...`);

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