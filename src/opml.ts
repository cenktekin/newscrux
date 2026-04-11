// src/opml.ts
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { FeedConfig } from './types.js';

interface OpmlBody {
  outline?: OpmlOutline[];
}

interface OpmlOutline {
  text?: string;
  xmlUrl?: string;
  htmlUrl?: string;
  type?: string;
  outline?: OpmlOutline[];
}

interface Opml {
  opml: {
    version?: string;
    head?: {
      title?: string;
    };
    body?: OpmlBody;
  };
}

export function parseOpml(opmlXml: string): FeedConfig[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
  });
  
  const parsed: Opml = parser.parse(opmlXml);
  const body = parsed.opml?.body;
  if (!body?.outline) {
    return [];
  }

  const feeds: FeedConfig[] = [];
  
  function processOutlines(outlines: OpmlOutline[]): void {
    for (const outline of outlines) {
      if (outline.xmlUrl) {
        const kind: FeedConfig['kind'] = outline.type === 'newsletter' ? 'newsletter' : 'official_blog';
        const priority: FeedConfig['priority'] = 'normal';
        feeds.push({
          name: outline.text || 'Unknown',
          url: outline.xmlUrl,
          kind,
          priority,
        });
      }
      if (outline.outline) {
        processOutlines(outline.outline);
      }
    }
  }
  
  processOutlines(body.outline);
  return feeds;
}

export function generateOpml(feeds: FeedConfig[], title?: string): string {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    format: true,
    indentBy: '  ',
  });

  const opml: Opml = {
    opml: {
      version: '2.0',
      head: title ? { title } : undefined,
      body: {
        outline: feeds.map(feed => ({
          text: feed.name,
          type: feed.kind === 'newsletter' ? 'newsletter' : 'rss',
          xmlUrl: feed.url,
          htmlUrl: feed.url,
        })),
      },
    },
  };

  return builder.build(opml);
}
