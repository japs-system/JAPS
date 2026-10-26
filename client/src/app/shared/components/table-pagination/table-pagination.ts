import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-table-pagination',
  imports: [],
  templateUrl: './table-pagination.html',
})
export class TablePagination {
  currentPage = input.required<number>();
  totalPages = input.required<number>();
  totalItems = input.required<number>();
  pageSize = input.required<number>();
  pageStart = input.required<number>();
  pageEnd = input.required<number>();
  pageNumbers = input.required<(number | '...')[]>();
  pageSizes = input<number[]>([10, 25, 50]);

  pageChange = output<number>();
  pageSizeChange = output<number>();

  setPage(p: number | '...'): void {
    if (p === '...' || p < 1 || p > this.totalPages()) return;
    this.pageChange.emit(p as number);
  }

  onPageSize(e: Event): void {
    this.pageSizeChange.emit(Number((e.target as HTMLSelectElement).value));
  }
}
