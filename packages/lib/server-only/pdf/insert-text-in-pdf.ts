import fontkit from '@pdf-lib/fontkit';
import type { PDFFont } from 'pdf-lib';
import { PDFDocument, rgb } from 'pdf-lib';

import {
  CAVEAT_FONT_PATH,
  NOTO_SANS_CJK_SC_FONT_PATH,
  NOTO_SANS_FONT_PATH,
} from '../../constants/pdf';

// Helper function to detect Chinese characters
const containsChinese = (text: string): boolean => {
  return /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}\u{2ceb0}-\u{2ebef}\u{30000}-\u{3134f}]/u.test(
    text,
  );
};

export async function insertTextInPDF(
  pdfAsBase64: string,
  text: string,
  positionX: number,
  positionY: number,
  page = 0,
  useHandwritingFont = true,
  customFontSize?: number,
): Promise<string> {
  const pdfDoc = await PDFDocument.load(pdfAsBase64);
  pdfDoc.registerFontkit(fontkit);

  let font: PDFFont;

  if (useHandwritingFont) {
    const fontResponse = await fetch(CAVEAT_FONT_PATH());
    const fontCaveat = await fontResponse.arrayBuffer();
    font = await pdfDoc.embedFont(fontCaveat);
  } else if (containsChinese(text)) {
    // Use CJK font for Chinese text
    const fontResponse = await fetch(NOTO_SANS_CJK_SC_FONT_PATH());
    const fontNotoCJK = await fontResponse.arrayBuffer();
    font = await pdfDoc.embedFont(fontNotoCJK, { subset: true });
  } else {
    // Use standard font for non-Chinese text
    const fontResponse = await fetch(NOTO_SANS_FONT_PATH());
    const fontNoto = await fontResponse.arrayBuffer();
    font = await pdfDoc.embedFont(fontNoto);
  }

  const pages = pdfDoc.getPages();
  const pdfPage = pages[page];

  const textSize = customFontSize || (useHandwritingFont ? 50 : 15);
  const textWidth = font.widthOfTextAtSize(text, textSize);
  const textHeight = font.heightAtSize(textSize);
  const fieldSize = { width: 250, height: 64 };

  // Because pdf-lib use a bottom-left coordinate system, we need to invert the y position
  // we then center the text in the middle by adding half the height of the text
  // plus the height of the field and divide the result by 2
  const invertedYPosition =
    pdfPage.getHeight() - positionY - (fieldSize.height + textHeight / 2) / 2;

  // We center the text by adding the width of the field, subtracting the width of the text
  // and dividing the result by 2
  const centeredXPosition = positionX + (fieldSize.width - textWidth) / 2;

  pdfPage.drawText(text, {
    x: centeredXPosition,
    y: invertedYPosition,
    size: textSize,
    color: rgb(0, 0, 0),
    font,
  });

  const pdfAsUint8Array = await pdfDoc.save();

  return Buffer.from(pdfAsUint8Array).toString('base64');
}
