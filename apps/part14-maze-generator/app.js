"use strict";

const DIFFICULTY_RATIOS = {
  hard: 0,
  normal: 0.08,
  easy: 0.18
};

const DIFFICULTY_LABELS = {
  hard: "むずかしい",
  normal: "ふつう",
  easy: "かんたん"
};

const DIRECTIONS = [
  { dr: -1, dc: 0, wall: "top", opposite: "bottom" },
  { dr: 0, dc: 1, wall: "right", opposite: "left" },
  { dr: 1, dc: 0, wall: "bottom", opposite: "top" },
  { dr: 0, dc: -1, wall: "left", opposite: "right" }
];

const state = {
  rows: 20,
  cols: 20,
  difficulty: "normal",
  maze: [],
  start: { r: 0, c: 0 },
  goal: { r: 19, c: 19 }
};

const sizeSelect = document.getElementById("maze-size");
const difficultySelect = document.getElementById("difficulty");
const generateButton = document.getElementById("generate-button");
const canvasContainer = document.getElementById("canvas-container");
const mazeCanvas = document.getElementById("maze-canvas");
const generationStatus = document.getElementById("generation-status");

function createGrid(rows, cols) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({
      visited: false,
      top: true,
      right: true,
      bottom: true,
      left: true
    }))
  );
}

function removeWall(grid, row, col, nextRow, nextCol, wall, opposite) {
  grid[row][col][wall] = false;
  grid[nextRow][nextCol][opposite] = false;
}

function generateMaze(rows, cols, randomFn = Math.random) {
  const grid = createGrid(rows, cols);
  const stack = [];
  let currentRow = 0;
  let currentCol = 0;
  let visitedCount = 1;
  grid[currentRow][currentCol].visited = true;

  while (visitedCount < rows * cols) {
    const candidates = [];
    for (const direction of DIRECTIONS) {
      const nextRow = currentRow + direction.dr;
      const nextCol = currentCol + direction.dc;
      if (
        nextRow >= 0 && nextRow < rows &&
        nextCol >= 0 && nextCol < cols &&
        !grid[nextRow][nextCol].visited
      ) {
        candidates.push({ nextRow, nextCol, ...direction });
      }
    }

    if (candidates.length > 0) {
      const candidateIndex = Math.floor(randomFn() * candidates.length);
      const chosen = candidates[candidateIndex];
      removeWall(
        grid,
        currentRow,
        currentCol,
        chosen.nextRow,
        chosen.nextCol,
        chosen.wall,
        chosen.opposite
      );
      stack.push({ row: currentRow, col: currentCol });
      currentRow = chosen.nextRow;
      currentCol = chosen.nextCol;
      grid[currentRow][currentCol].visited = true;
      visitedCount += 1;
    } else {
      const previous = stack.pop();
      currentRow = previous.row;
      currentCol = previous.col;
    }
  }

  return grid;
}

function collectRemainingWalls(grid, rows, cols) {
  const walls = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (col + 1 < cols && grid[row][col].right) {
        walls.push({ row, col, nextRow: row, nextCol: col + 1, wall: "right", opposite: "left" });
      }
      if (row + 1 < rows && grid[row][col].bottom) {
        walls.push({ row, col, nextRow: row + 1, nextCol: col, wall: "bottom", opposite: "top" });
      }
    }
  }
  return walls;
}

function removeExtraWalls(grid, rows, cols, ratio, randomFn = Math.random) {
  const remainingWalls = collectRemainingWalls(grid, rows, cols);
  const removeCount = Math.floor(remainingWalls.length * ratio);

  for (let index = remainingWalls.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(randomFn() * (index + 1));
    const temporary = remainingWalls[index];
    remainingWalls[index] = remainingWalls[swapIndex];
    remainingWalls[swapIndex] = temporary;
  }

  for (let index = 0; index < removeCount; index += 1) {
    const wall = remainingWalls[index];
    removeWall(
      grid,
      wall.row,
      wall.col,
      wall.nextRow,
      wall.nextCol,
      wall.wall,
      wall.opposite
    );
  }
  return grid;
}

function drawMaze(canvas, grid, rows, cols) {
  const context = canvas.getContext("2d");
  const cssSize = Math.max(1, Math.floor(canvasContainer.clientWidth));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssSize * dpr);
  canvas.height = Math.round(cssSize * dpr);
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, cssSize, cssSize);

  const cellSize = cssSize / cols;
  context.fillStyle = "#dff5e8";
  context.fillRect(0, 0, cellSize, cellSize);
  context.fillStyle = "#fde5e3";
  context.fillRect((cols - 1) * cellSize, (rows - 1) * cellSize, cellSize, cellSize);

  context.strokeStyle = "#172230";
  context.lineWidth = Math.max(1.25, Math.min(2.4, cellSize * 0.15));
  context.lineCap = "square";
  context.beginPath();
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = grid[row][col];
      const x = col * cellSize;
      const y = row * cellSize;
      if (cell.top) {
        context.moveTo(x, y);
        context.lineTo(x + cellSize, y);
      }
      if (cell.right) {
        context.moveTo(x + cellSize, y);
        context.lineTo(x + cellSize, y + cellSize);
      }
      if (cell.bottom) {
        context.moveTo(x, y + cellSize);
        context.lineTo(x + cellSize, y + cellSize);
      }
      if (cell.left) {
        context.moveTo(x, y);
        context.lineTo(x, y + cellSize);
      }
    }
  }
  context.stroke();

  const markerSize = Math.max(7, Math.min(cellSize * 0.62, 20));
  context.fillStyle = "#16583a";
  context.font = `800 ${markerSize}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("S", cellSize / 2, cellSize / 2);
  context.fillStyle = "#922b2b";
  context.fillText("G", (cols - 0.5) * cellSize, (rows - 0.5) * cellSize);
}

function createCurrentMaze(randomFn = Math.random) {
  const size = Number(sizeSelect.value);
  const difficulty = difficultySelect.value;
  const grid = generateMaze(size, size, randomFn);
  removeExtraWalls(grid, size, size, DIFFICULTY_RATIOS[difficulty], randomFn);

  state.rows = size;
  state.cols = size;
  state.difficulty = difficulty;
  state.maze = grid;
  state.start = { r: 0, c: 0 };
  state.goal = { r: size - 1, c: size - 1 };
  drawMaze(mazeCanvas, state.maze, state.rows, state.cols);
  generationStatus.textContent = `${size}×${size}、難易度${DIFFICULTY_LABELS[difficulty]}の迷路を生成しました`;
}

generateButton.addEventListener("click", () => createCurrentMaze());
window.addEventListener("resize", () => {
  if (state.maze.length > 0) {
    drawMaze(mazeCanvas, state.maze, state.rows, state.cols);
  }
});

createCurrentMaze();
