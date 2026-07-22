import fs from 'fs';
import path from 'path';
import handlebars from 'handlebars';
import puppeteer from 'puppeteer';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { ExtractedInspectionData } from '../ai/gpt.service';

export class PDFService {
  private outputDir = path.resolve(process.cwd(), 'output');
  private pdfBaseDir = path.resolve(process.cwd(), 'src', 'modules', 'pdf', 'templates', 'pdf_base');
  private hbsTemplatesDir = path.resolve(process.cwd(), 'src', 'modules', 'pdf', 'templates');

  constructor() {
    this.ensureDirectory();
  }

  private ensureDirectory() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    if (!fs.existsSync(this.pdfBaseDir)) {
      fs.mkdirSync(this.pdfBaseDir, { recursive: true });
    }
  }

  private fileToBase64DataUrl(filePath: string): string {
    try {
      if (!fs.existsSync(filePath)) return '';
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).replace('.', '').toLowerCase();
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch {
      return '';
    }
  }

  private getSignatureBuffer(): Buffer | null {
    try {
      const sigPath = path.resolve(process.cwd(), 'assets', 'signature.png');
      if (fs.existsSync(sigPath)) {
        return fs.readFileSync(sigPath);
      }
    } catch (e) {
      console.warn('[PDFService] Não foi possível carregar assets/signature.png');
    }
    return null;
  }

  private getSignatureBase64(): string {
    const buffer = this.getSignatureBuffer();
    return buffer ? `data:image/png;base64,${buffer.toString('base64')}` : '';
  }

  /**
   * Preenche um PDF original estático/formulário usando pdf-lib
   */
  private async fillPDFWithPdfLib(
    pdfTemplatePath: string,
    data: ExtractedInspectionData,
    imagePaths: string[],
    configPath?: string
  ): Promise<string> {
    console.log(`[PDFService] Preenchendo PDF original com pdf-lib: ${pdfTemplatePath}`);

    const existingPdfBytes = await fs.promises.readFile(pdfTemplatePath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // 1. Tenta preencher campos interativos de formulário (AcroForm) se existirem
    try {
      const form = pdfDoc.getForm();
      const fields = form.getFields();
      if (fields.length > 0) {
        console.log(`[PDFService] Formulário interativo detectado com ${fields.length} campos.`);
        const dataRecord = data as Record<string, any>;
        for (const field of fields) {
          const name = field.getName();
          if (dataRecord[name] !== undefined) {
            try {
              const textField = form.getTextField(name);
              textField.setText(String(dataRecord[name]));
            } catch {
              // Não é campo de texto simples
            }
          }
        }
      }
    } catch {
      // PDF não possui formulário interativo, usará escrita por coordenadas se houver json
    }

    // 2. Se houver um arquivo .json de configuração de coordenadas (ex: escritorio.json)
    if (configPath && fs.existsSync(configPath)) {
      try {
        const configRaw = await fs.promises.readFile(configPath, 'utf8');
        const coords = JSON.parse(configRaw);
        const dataRecord = data as Record<string, any>;
        const pages = pdfDoc.getPages();

        for (const [key, pos] of Object.entries<any>(coords)) {
          const val = dataRecord[key];
          if (val !== undefined && pos.page !== undefined && pages[pos.page]) {
            const targetPage = pages[pos.page];
            targetPage.drawText(String(val), {
              x: pos.x || 50,
              y: pos.y || 50,
              size: pos.fontSize || 10,
              font: pos.bold ? boldFont : font,
              color: rgb(0, 0, 0),
            });
          }
        }
      } catch (err) {
        console.warn('[PDFService] Erro ao aplicar coordenadas do JSON:', err);
      }
    }

    // 3. Estampa de Assinatura
    const sigBuffer = this.getSignatureBuffer();
    if (sigBuffer) {
      try {
        const sigImage = await pdfDoc.embedPng(sigBuffer);
        const firstPage = pdfDoc.getPages()[0];
        // Coloca no rodapé por padrão caso não especificado
        firstPage.drawImage(sigImage, {
          x: firstPage.getWidth() - 170,
          y: 40,
          width: 130,
          height: 50,
        });
      } catch (err) {
        console.warn('[PDFService] Erro ao aplicar assinatura no PDF:', err);
      }
    }

    // 4. Anexa folha de fotos de vistoria no final do PDF se existirem imagens
    if (imagePaths && imagePaths.length > 0) {
      console.log(`[PDFService] Anexando ${imagePaths.length} foto(s) ao PDF original...`);
      let photoPage = pdfDoc.addPage([595.28, 841.89]); // A4
      const { width, height } = photoPage.getSize();

      photoPage.drawText(`Anexo Fotográfico de Vistoria - Placa: ${data.placa}`, {
        x: 40,
        y: height - 40,
        size: 14,
        font: boldFont,
        color: rgb(0.1, 0.2, 0.5),
      });

      let currentX = 40;
      let currentY = height - 280;
      const imgWidth = 240;
      const imgHeight = 180;
      let itemsInPage = 0;

      for (let i = 0; i < imagePaths.length; i++) {
        const imgPath = imagePaths[i];
        if (!fs.existsSync(imgPath)) continue;

        try {
          const imgBytes = await fs.promises.readFile(imgPath);
          const isPng = imgPath.toLowerCase().endsWith('.png');
          const pdfImg = isPng ? await pdfDoc.embedPng(imgBytes) : await pdfDoc.embedJpg(imgBytes);

          if (itemsInPage === 4) {
            photoPage = pdfDoc.addPage([595.28, 841.89]);
            currentX = 40;
            currentY = height - 280;
            itemsInPage = 0;

            photoPage.drawText(`Anexo Fotográfico de Vistoria - Placa: ${data.placa} (Cont.)`, {
              x: 40,
              y: height - 40,
              size: 14,
              font: boldFont,
              color: rgb(0.1, 0.2, 0.5),
            });
          }

          photoPage.drawImage(pdfImg, {
            x: currentX,
            y: currentY,
            width: imgWidth,
            height: imgHeight,
          });

          // Moldura em volta da foto
          photoPage.drawRectangle({
            x: currentX,
            y: currentY,
            width: imgWidth,
            height: imgHeight,
            borderColor: rgb(0.8, 0.8, 0.8),
            borderWidth: 1,
          });

          itemsInPage++;
          if (itemsInPage % 2 === 1) {
            currentX = 315; // Segunda coluna
          } else {
            currentX = 40;  // Primeira coluna
            currentY -= 210; // Próxima linha
          }
        } catch (imgErr) {
          console.warn(`[PDFService] Erro ao incorporar foto no PDF: ${imgPath}`, imgErr);
        }
      }
    }

    const pdfBytes = await pdfDoc.save();
    const pdfFilename = `Laudo_Vistoria_${data.placa}_${Date.now()}.pdf`;
    const pdfPath = path.join(this.outputDir, pdfFilename);

    await fs.promises.writeFile(pdfPath, pdfBytes);
    console.log(`[PDFService] PDF preenchido com sucesso em: ${pdfPath}`);
    return pdfPath;
  }

  /**
   * Renderiza PDF via Puppeteer e Handlebars (.hbs)
   */
  private async generatePDFWithPuppeteer(
    templatePath: string,
    data: ExtractedInspectionData,
    imagePaths: string[]
  ): Promise<string> {
    console.log(`[PDFService] Compilando template HTML (${templatePath}) para placa ${data.placa}...`);

    const templateSource = await fs.promises.readFile(templatePath, 'utf8');
    const compiledTemplate = handlebars.compile(templateSource);

    const base64Images = imagePaths
      .map((p) => this.fileToBase64DataUrl(p))
      .filter((url) => url.length > 0);

    const signatureImage = this.getSignatureBase64();

    const htmlContent = compiledTemplate({
      ...data,
      formattedDate: new Date().toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      images: base64Images,
      signatureImage,
    });

    console.log('[PDFService] Renderizando PDF via Puppeteer...');

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    const pdfFilename = `Laudo_Vistoria_${data.placa}_${Date.now()}.pdf`;
    const pdfPath = path.join(this.outputDir, pdfFilename);

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        bottom: '20px',
        left: '20px',
        right: '20px',
      },
    });

    await browser.close();

    console.log(`[PDFService] PDF gerado via Puppeteer em: ${pdfPath}`);
    return pdfPath;
  }

  /**
   * Ponto de entrada principal para geração de laudos PDF.
   * Suporta modelos de escritórios em .pdf (pdf-lib) e .hbs (Puppeteer), com fallback automático.
   */
  public async generateInspectionPDF(
    data: ExtractedInspectionData,
    imagePaths: string[],
    officeTemplate?: string
  ): Promise<string> {
    try {
      if (officeTemplate) {
        const cleanName = officeTemplate.toLowerCase().trim();

        // 1. Procura se existe um PDF original base (ex: pdf_base/escritorio_a.pdf)
        const pdfBasePath = path.join(this.pdfBaseDir, `${cleanName}.pdf`);
        const jsonConfigPath = path.join(this.pdfBaseDir, `${cleanName}.json`);

        if (fs.existsSync(pdfBasePath)) {
          return await this.fillPDFWithPdfLib(pdfBasePath, data, imagePaths, jsonConfigPath);
        }

        // 2. Procura se existe um template .hbs específico (ex: templates/escritorio_a.hbs)
        const hbsPath = path.join(this.hbsTemplatesDir, `${cleanName}.hbs`);
        if (fs.existsSync(hbsPath)) {
          return await this.generatePDFWithPuppeteer(hbsPath, data, imagePaths);
        }

        console.warn(`[PDFService] Modelo '${officeTemplate}' não encontrado. Usando modelo padrão.`);
      }

      // 3. Fallback: Usa o modelo padrão inspection-report.hbs
      const defaultHbsPath = path.join(this.hbsTemplatesDir, 'inspection-report.hbs');
      return await this.generatePDFWithPuppeteer(defaultHbsPath, data, imagePaths);
    } catch (error) {
      console.error('[PDFService] Erro na geração do PDF:', error);
      throw error;
    }
  }
}

export const pdfService = new PDFService();
