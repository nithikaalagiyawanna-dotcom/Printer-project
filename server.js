const net = require('net');
const path = require('path');
const express = require('express');
const multer = require('multer'); // not used for files here, but can be handy later
const upload = multer({ storage: multer.memoryStorage() });
require('dotenv').config();

const PRINTER_IP = process.env.PRINTER_IP;
const PRINTER_PORT = parseInt(process.env.PRINTER_PORT || '9100', 10);
const APP_PORT = parseInt(process.env.APP_PORT || '8080', 10);

const app = express();

// Serve static UI
app.use(express.static(path.join(__dirname, 'public')));

// Parse form data (multipart for FormData; we do not handle files here)
app.use(upload.none());

// -----------------------
// ZPL Builder
// -----------------------
function sanitize(s) {
  return (s || '').toString().replace(/[\^~\\]/g, ' ');
}

function buildZPL({
  sampleName = '',
  price = '',
  notes = '',
  barcode = '',
  barcodeType = 'code128',
  fontMain = 28,
  fontSmall = 22,
  rotate = 'N',
  // Logo
  logoHex = '',
  logoW = 0,
  logoH = 0,
  logoX = 300,
  logoY = 10
}) {
  const widthDots = 406; // 2.00in * 203dpi
  const heightDots = 203; // 1.00in * 203dpi

  const topY   = 12;
  const line2Y = 12 + 34;
  const notesY = line2Y + 28;
  const codeY  = notesY + 30;

  let z = [];
  z.push('^XA');
  z.push(`^PW${widthDots}`);
  z.push(`^LL${heightDots}`);
  z.push('^LH0,0');
  z.push('^CI0'); // ASCII (switch later to CI28 if you embed UTF-8 + fonts)

  // Headline
  z.push(`^CF0,${parseInt(fontMain,10)}`);
  z.push(`^FO10,${topY}^FD${sanitize(sampleName)}^FS`);

  // Price line
  z.push(`^CF0,${parseInt(fontSmall,10)}`);
  z.push(`^FO10,${line2Y}^FD${sanitize(price)}^FS`);

  // Notes
  if (notes) {
    z.push(`^CF0,${parseInt(fontSmall,10)}`);
    z.push(`^FO10,${notesY}^FD${sanitize(notes)}^FS`);
  }

  // Barcode / QR
  if (barcode) {
    if ((barcodeType || 'code128').toLowerCase() === 'qr') {
      // Model 2, ECC H, cell size 3
      z.push(`^FO10,${codeY}^BQN,2,3^FDLA,${sanitize(barcode)}^FS`);
    } else {
      z.push('^BY2,2,50');
      z.push(`^FO10,${codeY}^BC${(rotate||'N').toUpperCase()},60,Y,N,N`);
      z.push(`^FD${sanitize(barcode)}^FS`);
    }
  }

  // Optional logo via ^GFA
  if (logoHex && logoW > 0 && logoH > 0) {
    const w = parseInt(logoW, 10);
    const h = parseInt(logoH, 10);
    const x = Math.max(0, parseInt(logoX, 10));
    const y = Math.max(0, parseInt(logoY, 10));
    const bytesPerRow = Math.ceil(w / 8);
    const totalBytes = bytesPerRow * h;

    // Validate hex string (only 0-9 A-F allowed)
    const hex = (logoHex || '').toString().toUpperCase();
    if (!/^[0-9A-F]*$/.test(hex) || hex.length !== totalBytes * 2) {
      // If invalid, ignore the logo rather than failing the whole print
      console.warn('Logo data invalid or mismatched; skipping ^GFA');
    } else {
      z.push(`^FO${x},${y}`);
      // ^GFA,total_bytes,bytes_per_row,rows,<HEX DATA>
      z.push(`^GFA,${totalBytes},${bytesPerRow},${h},${hex}`);
      z.push('^FS');
    }
  }

  z.push('^XZ');
  return z.join('\n');
}

// -----------------------
// Send to printer
// -----------------------
function sendToPrinter(zpl) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(7000);

    socket.connect(PRINTER_PORT, PRINTER_IP, () => {
      socket.write(zpl, 'utf8', () => {
        socket.end();
      });
    });

    socket.on('close', () => resolve());
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy(new Error('Timeout connecting to printer'));
      reject(new Error('Timeout connecting to printer'));
    });
  });
}

// -----------------------
// Routes
// -----------------------
app.post('/print', async (req, res) => {
  try {
    const zpl = buildZPL({
      sampleName: req.body.sampleName,
      price: req.body.price,
      notes: req.body.notes,
      barcode: req.body.barcode,
      barcodeType: req.body.barcodeType,
      fontMain: req.body.fontMain,
      fontSmall: req.body.fontSmall,
      rotate: req.body.rotate,
      logoHex: req.body.logoHex,
      logoW: parseInt(req.body.logoW || '0', 10),
      logoH: parseInt(req.body.logoH || '0', 10),
      logoX: parseInt(req.body.logoX || '300', 10),
      logoY: parseInt(req.body.logoY || '10', 10)
    });

    await sendToPrinter(zpl);
    res.status(200).send('OK');
  } catch (err) {
    console.error(err);
    res.status(500).send('Printing failed: ' + err.message);
  }
});

app.listen(APP_PORT, () => {
  console.log(`Label app running at http://0.0.0.0:${APP_PORT}`);
});
