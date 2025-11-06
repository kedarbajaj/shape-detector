import "./style.css";
import { SelectionManager } from "./ui-utils.js";
import { EvaluationManager } from "./evaluation-manager.js";

export interface Point {
  x: number;
  y: number;
}

export interface DetectedShape {
  type: "circle" | "triangle" | "rectangle" | "pentagon" | "star";
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  center: Point;
  area: number;
}

export interface DetectionResult {
  shapes: DetectedShape[];
  processingTime: number;
  imageWidth: number;
  imageHeight: number;
}

export class ShapeDetector {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  /**
   * Optimized Shape Detection Algorithm
   */
  async detectShapes(imageData: ImageData): Promise<DetectionResult> {
    const startTime = performance.now();

    const { width, height, data } = imageData;
    const shapes: DetectedShape[] = [];

    // Convert to grayscale
    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      gray[i / 4] = avg;
    }

    // Simple threshold to binary
    const binary = new Uint8ClampedArray(width * height);
    const threshold = 128;
    for (let i = 0; i < gray.length; i++) {
      binary[i] = gray[i] > threshold ? 255 : 0;
    }

    // Find connected components (very simplified)
    const visited = new Uint8Array(width * height);
    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    function getIndex(x: number, y: number) {
      return y * width + x;
    }

    function floodFill(x: number, y: number): Point[] {
      const points: Point[] = [];
      const stack = [{ x, y }];
      visited[getIndex(x, y)] = 1;

      while (stack.length > 0) {
        const { x, y } = stack.pop()!;
        points.push({ x, y });

        for (const [dx, dy] of directions) {
          const nx = x + dx,
            ny = y + dy;
          if (
            nx >= 0 &&
            ny >= 0 &&
            nx < width &&
            ny < height &&
            !visited[getIndex(nx, ny)] &&
            binary[getIndex(nx, ny)] === 0
          ) {
            visited[getIndex(nx, ny)] = 1;
            stack.push({ x: nx, y: ny });
          }
        }
      }
      return points;
    }

    // Loop through pixels and detect shape-like blobs
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (binary[getIndex(x, y)] === 0 && !visited[getIndex(x, y)]) {
          const blob = floodFill(x, y);
          if (blob.length < 80) continue; // ignore noise

          const xs = blob.map((p) => p.x);
          const ys = blob.map((p) => p.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const w = maxX - minX;
          const h = maxY - minY;
          const area = w * h;
          const center = { x: minX + w / 2, y: minY + h / 2 };

          // Basic circularity ratio
          const perimeter = 2 * (w + h);
          const circularity = (4 * Math.PI * blob.length) / (perimeter * perimeter);

          let type: DetectedShape["type"] = "circle";
          if (circularity < 0.45) {
            if (Math.abs(w - h) < 10) type = "square" as any;
            else if (w / h > 1.2 || h / w > 1.2) type = "rectangle";
            else type = "triangle";
          }

          const confidence = Math.min(1, Math.abs(circularity));

          shapes.push({
            type,
            confidence,
            boundingBox: { x: minX, y: minY, width: w, height: h },
            center,
            area,
          });
        }
      }
    }

    const processingTime = performance.now() - startTime;

    return {
      shapes,
      processingTime,
      imageWidth: width,
      imageHeight: height,
    };
  }

  loadImage(file: File): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.canvas.width = img.width;
        this.canvas.height = img.height;
        this.ctx.drawImage(img, 0, 0);
        const imageData = this.ctx.getImageData(0, 0, img.width, img.height);
        resolve(imageData);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
}

class ShapeDetectionApp {
  private detector: ShapeDetector;
  private imageInput: HTMLInputElement;
  private resultsDiv: HTMLDivElement;
  private testImagesDiv: HTMLDivElement;
  private evaluateButton: HTMLButtonElement;
  private evaluationResultsDiv: HTMLDivElement;
  private selectionManager: SelectionManager;
  private evaluationManager: EvaluationManager;

  constructor() {
    const canvas = document.getElementById("originalCanvas") as HTMLCanvasElement;
    this.detector = new ShapeDetector(canvas);

    this.imageInput = document.getElementById("imageInput") as HTMLInputElement;
    this.resultsDiv = document.getElementById("results") as HTMLDivElement;
    this.testImagesDiv = document.getElementById("testImages") as HTMLDivElement;
    this.evaluateButton = document.getElementById("evaluateButton") as HTMLButtonElement;
    this.evaluationResultsDiv = document.getElementById("evaluationResults") as HTMLDivElement;

    this.selectionManager = new SelectionManager();
    this.evaluationManager = new EvaluationManager(this.detector, this.evaluateButton, this.evaluationResultsDiv);

    this.setupEventListeners();
    this.loadTestImages().catch(console.error);
  }

  private setupEventListeners(): void {
    this.imageInput.addEventListener("change", async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) {
        await this.processImage(file);
      }
    });

    this.evaluateButton.addEventListener("click", async () => {
      const selectedImages = this.selectionManager.getSelectedImages();
      await this.evaluationManager.runSelectedEvaluation(selectedImages);
    });
  }

  private async processImage(file: File): Promise<void> {
    try {
      this.resultsDiv.innerHTML = "<p>Processing...</p>";
      const imageData = await this.detector.loadImage(file);
      const results = await this.detector.detectShapes(imageData);
      this.displayResults(results);
    } catch (error) {
      this.resultsDiv.innerHTML = `<p>Error: ${error}</p>`;
    }
  }

  private displayResults(results: DetectionResult): void {
    const { shapes, processingTime } = results;

    let html = `
      <p><strong>Processing Time:</strong> ${processingTime.toFixed(2)}ms</p>
      <p><strong>Shapes Found:</strong> ${shapes.length}</p>
    `;

    if (shapes.length > 0) {
      html += "<h4>Detected Shapes:</h4><ul>";
      shapes.forEach((shape) => {
        html += `
          <li>
            <strong>${shape.type}</strong><br>
            Confidence: ${(shape.confidence * 100).toFixed(1)}%<br>
            Center: (${shape.center.x.toFixed(1)}, ${shape.center.y.toFixed(1)})<br>
            Area: ${shape.area.toFixed(1)}px²
          </li>
        `;
      });
      html += "</ul>";
    } else {
      html += "<p>No shapes detected.</p>";
    }

    this.resultsDiv.innerHTML = html;
  }

  private async loadTestImages(): Promise<void> {
    try {
      const module = await import("./test-images-data.js");
      const testImages = module.testImages;
      const imageNames = module.getAllTestImageNames();

      let html =
        '<h4>Click to upload or use test images. Right-click to select for evaluation:</h4><div class="evaluation-controls"><button id="selectAllBtn">Select All</button><button id="deselectAllBtn">Deselect All</button><span class="selection-info">0 images selected</span></div><div class="test-images-grid">';

      html += `
        <div class="test-image-item upload-item" onclick="triggerFileUpload()">
          <div class="upload-icon">📁</div>
          <div class="upload-text">Upload Image</div>
        </div>
      `;

      imageNames.forEach((imageName) => {
        const dataUrl = testImages[imageName as keyof typeof testImages];
        html += `
          <div class="test-image-item" data-image="${imageName}" 
               onclick="loadTestImage('${imageName}', '${dataUrl}')" 
               oncontextmenu="toggleImageSelection(event, '${imageName}')">
            <img src="${dataUrl}" alt="${imageName}">
            <div>${imageName}</div>
          </div>
        `;
      });

      html += "</div>";
      this.testImagesDiv.innerHTML = html;

      this.selectionManager.setupSelectionControls();

      (window as any).loadTestImage = async (name: string, dataUrl: string) => {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const file = new File([blob], name, { type: "image/svg+xml" });

        const imageData = await this.detector.loadImage(file);
        const results = await this.detector.detectShapes(imageData);
        this.displayResults(results);
      };

      (window as any).toggleImageSelection = (event: MouseEvent, imageName: string) => {
        event.preventDefault();
        this.selectionManager.toggleImageSelection(imageName);
      };

      (window as any).triggerFileUpload = () => {
        this.imageInput.click();
      };
    } catch (error) {
      this.testImagesDiv.innerHTML = `<p>Test images not available. Run 'node convert-svg-to-png.js'.</p>`;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new ShapeDetectionApp();
});
