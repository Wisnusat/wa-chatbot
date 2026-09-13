export function createRingBuffer<T>(maxSize: number) {
  const items: T[] = [];

  return {
    push(item: T): void {
      items.push(item);
      if (items.length > maxSize) {
        items.shift();
      }
    },
    getAll(): T[] {
      return [...items];
    },
  };
}
