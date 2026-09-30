import type { ResponseMeta } from "./types.js";

/** What a page fetcher returns: the items, the raw body, and the params for the next page (null at the end). */
export interface PageResult<Item, Body, Params> {
  items: Item[];
  body: Body;
  meta: ResponseMeta;
  next: Params | null;
}

export type PageFetcher<Item, Body, Params> = (params: Params) => Promise<PageResult<Item, Body, Params>>;

/**
 * One page of a list endpoint. `data` holds this page's items and `body` the raw response.
 * Iterating a page with `for await` walks every item on this page and all following pages.
 *
 * Works for both pagination styles the API uses: cursor (`next_cursor` → `cursor`) and keyset
 * (`page.next_before` + `page.next_before_id` → `before` + `before_id`).
 */
export class Page<Item, Body = unknown, Params = unknown> implements AsyncIterable<Item> {
  readonly data: Item[];
  readonly body: Body;
  readonly _meta: ResponseMeta;
  /** Params that fetch the next page, or null when this is the last page. */
  readonly nextParams: Params | null;

  constructor(
    private readonly fetcher: PageFetcher<Item, Body, Params>,
    result: PageResult<Item, Body, Params>,
  ) {
    this.data = result.items;
    this.body = result.body;
    this._meta = result.meta;
    this.nextParams = result.next;
    Object.defineProperty(this, "fetcher", { enumerable: false });
  }

  hasNextPage(): boolean {
    return this.nextParams !== null;
  }

  /** Fetch the following page. Throws when there is none; check `hasNextPage()` first. */
  async getNextPage(): Promise<Page<Item, Body, Params>> {
    if (this.nextParams === null) throw new Error("No next page; check hasNextPage() first.");
    return new Page(this.fetcher, await this.fetcher(this.nextParams));
  }

  /** Iterate pages, starting with this one. */
  async *iterPages(): AsyncGenerator<Page<Item, Body, Params>> {
    let page: Page<Item, Body, Params> = this;
    yield page;
    while (page.hasNextPage()) {
      page = await page.getNextPage();
      yield page;
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Item> {
    for await (const page of this.iterPages()) yield* page.data;
  }
}

/**
 * The return value of list methods: `await` it for the first page, or `for await` it
 * directly to iterate every item across all pages.
 */
export class PagePromise<Item, Body = unknown, Params = unknown>
  implements PromiseLike<Page<Item, Body, Params>>, AsyncIterable<Item>
{
  private readonly promise: Promise<Page<Item, Body, Params>>;

  constructor(fetcher: PageFetcher<Item, Body, Params>, first: Params) {
    // Lazy: nothing is sent until the caller awaits or iterates.
    let p: Promise<Page<Item, Body, Params>> | undefined;
    this.promise = {
      then: (a: never, b: never) => (p ??= fetcher(first).then((r) => new Page(fetcher, r))).then(a, b),
    } as unknown as Promise<Page<Item, Body, Params>>;
  }

  then<R1 = Page<Item, Body, Params>, R2 = never>(
    onfulfilled?: ((value: Page<Item, Body, Params>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return Promise.resolve(this.promise).then(onfulfilled, onrejected);
  }

  catch<R = never>(onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<Page<Item, Body, Params> | R> {
    return this.then(undefined, onrejected);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Item> {
    const page = await this;
    yield* page;
  }
}
