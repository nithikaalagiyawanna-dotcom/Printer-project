const net = require('net');
const path = require('path');
const express = require('express');
const bodyParser = require('express').urlencoded({ extended: true });
require('dotenv').config();

const PRINTER_IP = process.env.PRINTER_IP;
const PRINTER_PORT = parseInt(process.env.PRINTER_PORT || '9100', 10);
const APP_PORT = parseInt(process.env.APP_PORT || '8080', 10);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser);

// --- ZPL generator for 2" x 1" (≈ 406 x 203 dots at 203 dpi) ---
function buildZPL({
  sampleName = '',
  price = '',
  notes = '',
  barcode = '',
  barcodeType = 'code128',   // 'code128' or 'qr'
  fontMain = 28,             // font height (points ~ dots for ^CF0)
  fontSmall = 22,
  rotate = 'N'               // N=normal,R=90
}) {
  // Page size
  const widthDots = 406;  // 2.00 in * 203 dpi
  const heightDots = 203; // 1.00 in * 203 dpi

  // Basic layout (tweak FO/Y as needed)
  const topY = 12;
  const line2Y = 12 + 34;      // after first line
  const notesY = line2Y + 28;  // notes line
  const codeY = notesY + 30;   // barcode/QR area

  const esc = s => (s || '').toString().replace(/[\^~\\]/g, ' '); // sanitize basic ZPL specials

  let barcodeZpl = '';
  if (barcode) {
    if (barcodeType === 'qr') {
      // ^BQN: Model 2, error correction H, cell size 3
      barcodeZpl =
        `^FO10,${codeY}^BQN,2,3^FDLA,${esc(barcode)}^FS\n`;
    } else {
      // ^BC: Code 128, height 60, print human-readable
      barcodeZpl =
        `^BY2,2,50\n^FO10,${codeY}^BC${rotate},60,Y,N,N\n^FD${esc(barcode)}^FS\n`;
    }
  }

  return [
    '^XA',
    `^PW${widthDots}`,
    `^LL${heightDots}`,
    '^LH0,0',
    '^CI0', // ASCII; change to CI28 if you later add Unicode/UTF-8 fonts

    // Headline (sample name)
    `^CF0,${fontMain}`,
    `^FO10,${topY}^FD${esc(sampleName)}^FS`,

    // Price line
    `^CF0,${fontSmall}`,
    `^FO10,${line2Y}^FD${esc(price)}^FS`,

    // Notes / extra
    notes ? `^CF0,${fontSmall}^FO10,${notesY}^FD${esc(notes)}^FS` : '',

    // Barcode or QR
    barcodeZpl,

    '^XZ'
  ].join('\n');
}

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

// Web form posts here
app.post('/print', async (req, res) => {
  try {
    const {
      sampleName, price, notes, barcode, barcodeType,
      fontMain, fontSmall, rotate
    } = req.body;

    const zpl = buildZPL({
      sampleName, price, notes, barcode, barcodeType,
      fontMain: parseInt(fontMain || '28', 10),
      fontSmall: parseInt(fontSmall || '22', 10),
      rotate: (rotate || 'N').toUpperCase()
    });

    await sendToPrinter(zpl);
    res.status(200).send('Label sent to printer.');
  } catch (err) {
    res.status(500).send('Printing failed: ' + err.message);
  }
});

app.listen(APP_PORT, () => {
  console.log(`Label app running at http://0.0.0.0:${APP_PORT}`);
});