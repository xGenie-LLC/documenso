import type { PDFField, PDFWidgetAnnotation } from '@cantoo/pdf-lib';
import {
  PDFCheckBox,
  PDFDict,
  type PDFDocument,
  PDFName,
  PDFRadioGroup,
  PDFRef,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rotateInPlace,
  translate,
} from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';

import { NEXT_PUBLIC_WEBAPP_URL } from '../../constants/app';
import { NOTO_SANS_CJK_SC_FONT_PATH } from '../../constants/pdf';

export const removeOptionalContentGroups = (document: PDFDocument) => {
  const context = document.context;
  const catalog = context.lookup(context.trailerInfo.Root);
  if (catalog instanceof PDFDict) {
    catalog.delete(PDFName.of('OCProperties'));
  }
};

// Helper function to detect Chinese characters
const containsChinese = (text: string): boolean => {
  return /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}\u{2ceb0}-\u{2ebef}\u{30000}-\u{3134f}]/u.test(
    text,
  );
};

export const flattenForm = async (document: PDFDocument) => {
  removeOptionalContentGroups(document);

  const form = document.getForm();

  // Check if any form field contains Chinese text
  let needsCJKFont = false;
  for (const field of form.getFields()) {
    try {
      // Get field value based on field type
      let fieldValue = '';
      if ('getText' in field && typeof field.getText === 'function') {
        fieldValue = field.getText() || '';
      } else if ('getSelected' in field && typeof field.getSelected === 'function') {
        const selected = field.getSelected();
        fieldValue = Array.isArray(selected) ? selected.join(' ') : selected || '';
      } else if ('isChecked' in field && typeof field.isChecked === 'function') {
        fieldValue = field.isChecked() ? 'checked' : '';
      }

      if (containsChinese(fieldValue)) {
        needsCJKFont = true;
        break;
      }
    } catch (error) {
      // Continue checking other fields if one fails
      console.error('Error checking field value:', error);
    }
  }

  document.registerFontkit(fontkit);

  // Load appropriate fonts based on content
  let font;
  if (needsCJKFont) {
    console.log('Chinese text detected in form fields, loading CJK font');
    const fontCJK = await fetch(NOTO_SANS_CJK_SC_FONT_PATH()).then(async (res) =>
      res.arrayBuffer(),
    );
    font = await document.embedFont(fontCJK, { subset: true });
  } else {
    const fontNoto = await fetch(`${NEXT_PUBLIC_WEBAPP_URL()}/fonts/noto-sans.ttf`).then(
      async (res) => res.arrayBuffer(),
    );
    font = await document.embedFont(fontNoto);
  }

  form.updateFieldAppearances(font);

  for (const field of form.getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      flattenWidget(document, field, widget);
    }

    try {
      form.removeField(field);
    } catch (error) {
      console.error(error);
    }
  }
};

const getPageForWidget = (document: PDFDocument, widget: PDFWidgetAnnotation) => {
  const pageRef = widget.P();

  let page = document.getPages().find((page) => page.ref === pageRef);

  if (!page) {
    const widgetRef = document.context.getObjectRef(widget.dict);

    if (!widgetRef) {
      return null;
    }

    page = document.findPageForAnnotationRef(widgetRef);

    if (!page) {
      return null;
    }
  }

  return page;
};

const getAppearanceRefForWidget = (field: PDFField, widget: PDFWidgetAnnotation) => {
  try {
    const normalAppearance = widget.getNormalAppearance();
    let normalAppearanceRef: PDFRef | null = null;

    if (normalAppearance instanceof PDFRef) {
      normalAppearanceRef = normalAppearance;
    }

    if (
      normalAppearance instanceof PDFDict &&
      (field instanceof PDFCheckBox || field instanceof PDFRadioGroup)
    ) {
      const value = field.acroField.getValue();
      const ref = normalAppearance.get(value) ?? normalAppearance.get(PDFName.of('Off'));

      if (ref instanceof PDFRef) {
        normalAppearanceRef = ref;
      }
    }

    return normalAppearanceRef;
  } catch (error) {
    console.error(error);

    return null;
  }
};

const flattenWidget = (document: PDFDocument, field: PDFField, widget: PDFWidgetAnnotation) => {
  try {
    const page = getPageForWidget(document, widget);

    if (!page) {
      return;
    }

    const appearanceRef = getAppearanceRefForWidget(field, widget);

    if (!appearanceRef) {
      return;
    }

    const xObjectKey = page.node.newXObject('FlatWidget', appearanceRef);

    const rectangle = widget.getRectangle();
    const operators = [
      pushGraphicsState(),
      translate(rectangle.x, rectangle.y),
      ...rotateInPlace({ ...rectangle, rotation: 0 }),
      drawObject(xObjectKey),
      popGraphicsState(),
    ].filter((op) => !!op);

    page.pushOperators(...operators);
  } catch (error) {
    console.error(error);
  }
};
