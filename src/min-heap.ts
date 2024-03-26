
type KeysMatching<T, V> = {
  [K in keyof T]: T[K] extends V ? K : never
}[keyof T];

export class MinHeap<T>{
  private heap: T[];
  private key: KeysMatching<T, number>;
  private debug = false;
  constructor(propName: KeysMatching<T, number>);
  constructor(propName: KeysMatching<T, number>, initial: T[]);
  constructor(propName: KeysMatching<T, number>, initial?: T[]) {
    this.heap = initial ?? [];
    this.key = propName;
  }
  public enableDebug() {
    this.debug = true;
  }
  private getParentIndex(i: number): number {
    return Math.floor((i - 1) / 2);
  }
  private getLeftChildIndex(parentIndex: number): number {
    return 2 * parentIndex + 1;
  }
  private getRightChildIndex(parentIndex: number): number {
    return 2 * parentIndex + 2;
  }
  private swap(index1: number, index2: number) {
    [this.heap[index1], this.heap[index2]] = [this.heap[index2], this.heap[index1]];
  }
  private heapifySwapCount = 0;
  private heapifyUp() {
    if (this.debug) { this.heapifySwapCount = 0; }
    let index = this.heap.length - 1;
    while (this.getParentIndex(index) >= 0 && this.heap[this.getParentIndex(index)][this.key] > this.heap[index][this.key]) {
      this.swap(this.getParentIndex(index), index);
      if (this.debug) { this.heapifySwapCount++; }
      index = this.getParentIndex(index);
    }
    if (this.debug) { console.error(`Heapify Up: swap count ${this.heapifySwapCount}`); }
  }
  private heapifyDown() {
    if (this.debug) { this.heapifySwapCount = 0; }
    let index = 0;
    while (this.getLeftChildIndex(index) < this.heap.length) {
      let smallerChildIndex = this.getLeftChildIndex(index);
      if (this.getRightChildIndex(index) < this.heap.length && this.heap[this.getRightChildIndex(index)][this.key] < this.heap[smallerChildIndex][this.key]) {
        smallerChildIndex = this.getRightChildIndex(index);
      }

      if (this.heap[index][this.key] < this.heap[smallerChildIndex][this.key]) {
        break;
      }
      if (this.debug) { this.heapifySwapCount++; }
      this.swap(index, smallerChildIndex);

      index = smallerChildIndex;
    }
    if (this.debug) { console.error(`Heapify Down: swap count ${this.heapifySwapCount}`); }
  }
  public insert(value: T) {
    this.heap.push(value);
    this.heapifyUp();
  }
  public extractMin(): T | undefined {
    if (this.heap.length === 0) {
      return undefined;
    }
    const min = this.heap[0];
    const lastElement = this.heap.pop();
    if (this.heap.length > 0 && lastElement !== undefined) {
      this.heap[0] = lastElement;
      this.heapifyDown();
    }
    return min;
  }
  public peek(): T | undefined {
    return this.heap.length > 0 ? this.heap[0] : undefined;
  }
  public clear(): void {
    this.heap = [];
  }
  // just passes internal value: does not preserve integrity of instance.
  public dump(): T[] {
    return this.heap;
  }
}


