// netlify/functions/upload-notion.js
export default async (request, context) => {
  // Solo permitir POST requests
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { title, markdownContent, notionToken, parentPageId } = await request.json();
    
    // Validar que tenemos todos los datos necesarios
    if (!title || !markdownContent || !notionToken || !parentPageId) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: title, markdownContent, notionToken, parentPageId' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parsear markdown a bloques de Notion
    const blocks = parseMarkdownWithMath(markdownContent);
    
    // Crear la página primero (sin children para evitar límite de 100)
    const pagePayload = {
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [
            {
              text: {
                content: title
              }
            }
          ]
        }
      }
    };

    // Crear página vacía
    const pageResponse = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(pagePayload)
    });

    if (!pageResponse.ok) {
      const errorData = await pageResponse.text();
      console.error('Notion API Error creating page:', pageResponse.status, errorData);
      return new Response(JSON.stringify({ 
        error: `Notion API Error: ${pageResponse.status} - ${errorData}` 
      }), {
        status: pageResponse.status,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const pageResult = await pageResponse.json();
    const pageId = pageResult.id;

    // Agregar bloques en lotes de 100
    const batchSize = 100;
    for (let i = 0; i < blocks.length; i += batchSize) {
      const batch = blocks.slice(i, i + batchSize);
      
      const appendResponse = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          children: batch
        })
      });

      if (!appendResponse.ok) {
        const errorData = await appendResponse.text();
        console.error('Notion API Error appending blocks:', appendResponse.status, errorData);
        return new Response(JSON.stringify({ 
          error: `Notion API Error appending blocks: ${appendResponse.status} - ${errorData}` 
        }), {
          status: appendResponse.status,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }

    const result = pageResult;
    
    // Devolver resultado exitoso
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('Server Error:', error);
    return new Response(JSON.stringify({ 
      error: `Server Error: ${error.message}` 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};

// Función para parsear Markdown completo
function parseMarkdownWithMath(markdownContent) {
  const blocks = [];
  const lines = markdownContent.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Handle math blocks ($...$)
    if (line.startsWith('$')) {
      const mathContent = [];
      i++;
      while (i < lines.length && !lines[i].trim().endsWith('$')) {
        mathContent.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        const lastLine = lines[i].replace('$', '').trim();
        if (lastLine) {
          mathContent.push(lastLine);
        }
      }

      blocks.push({
        object: "block",
        type: "equation",
        equation: {
          expression: mathContent.join('\n').trim()
        }
      });
    }
    // Handle code blocks (```...```)
    else if (line.startsWith('```')) {
      const codeContent = [];
      const language = line.replace('```', '').trim() || 'plain text';
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeContent.push(lines[i]);
        i++;
      }

      blocks.push({
        object: "block",
        type: "code",
        code: {
          caption: [],
          rich_text: [
            {
              type: "text",
              text: {
                content: codeContent.join('\n')
              }
            }
          ],
          language: language
        }
      });
    }
    // Handle horizontal dividers (---)
    else if (line === '---' || line === '***' || line === '___') {
      blocks.push({
        object: "block",
        type: "divider",
        divider: {}
      });
    }
    // Handle headers
    else if (line.startsWith('#')) {
      const level = line.length - line.replace(/^#+/, '').length;
      const text = line.replace(/^#+\s*/, '');
      
      const blockType = level === 1 ? "heading_1" : 
                       level === 2 ? "heading_2" : "heading_3";
      
      blocks.push({
        object: "block",
        type: blockType,
        [blockType]: {
          rich_text: processRichText(text)
        }
      });
    }
    // Handle unordered lists (- item)
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      const text = line.replace(/^[-*]\s+/, '');
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: processRichText(text)
        }
      });
    }
    // Handle ordered lists (1. item)
    else if (/^\d+\.\s/.test(line)) {
      const text = line.replace(/^\d+\.\s+/, '');
      blocks.push({
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: processRichText(text)
        }
      });
    }
    // Handle quotes (> text)
    else if (line.startsWith('> ')) {
      const text = line.replace(/^>\s+/, '');
      blocks.push({
        object: "block",
        type: "quote",
        quote: {
          rich_text: processRichText(text)
        }
      });
    }
    // Handle regular paragraphs
    else if (line && !line.startsWith('$')) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: processRichText(line)
        }
      });
    }
    // Handle empty lines
    else if (!line) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: []
        }
      });
    }

    i++;
  }

  return blocks;
}

// Función completa para procesar texto enriquecido
function processRichText(text) {
  const richText = [];
  
  // Primero, encontrar todas las ecuaciones matemáticas y reemplazarlas temporalmente
  const mathPlaceholders = [];
  let tempText = text;
  let mathIndex = 0;
  
  // Reemplazar ecuaciones matemáticas con placeholders
  tempText = tempText.replace(/\$([^$\n]+)\$/g, (match, equation) => {
    const placeholder = `__MATH_${mathIndex}__`;
    mathPlaceholders[mathIndex] = equation.trim();
    mathIndex++;
    return placeholder;
  });
  
  // Procesar formato de texto en el texto sin matemáticas
  const textParts = processTextFormatting(tempText);
  
  // Restaurar las ecuaciones matemáticas
  for (const part of textParts) {
    if (part.type === "text" && part.text.content.includes('__MATH_')) {
      // Dividir por placeholders de matemáticas
      const segments = part.text.content.split(/(__MATH_\d+__)/);
      
      for (const segment of segments) {
        if (segment.startsWith('__MATH_') && segment.endsWith('__')) {
          // Es un placeholder de matemática
          const index = parseInt(segment.match(/\d+/)[0]);
          if (mathPlaceholders[index]) {
            richText.push({
              type: "equation",
              equation: {
                expression: mathPlaceholders[index]
              }
            });
          }
        } else if (segment) {
          // Es texto normal
          richText.push({
            type: "text",
            text: {
              content: segment
            },
            annotations: part.annotations || {}
          });
        }
      }
    } else {
      richText.push(part);
    }
  }

  return richText;
}

function processTextFormatting(text) {
  const parts = [];
  let currentIndex = 0;
  
  // Regex patterns for different formatting (sin incluir $ para matemáticas)
  const patterns = [
    { 
      regex: /\*\*([^*\n]+?)\*\*/g, 
      format: { bold: true },
      type: 'bold'
    },
    { 
      regex: /(?<!\*)\*([^*\n]+?)\*(?!\*)/g, 
      format: { italic: true },
      type: 'italic'
    },
    { 
      regex: /`([^`\n]+?)`/g, 
      format: { code: true },
      type: 'code'
    },
    {
      regex: /\[([^\]]+?)\]\(([^)\n]+?)\)/g,
      format: null,
      type: 'link'
    }
  ];
  
  // Find all matches and their positions
  const matches = [];
  
  patterns.forEach(pattern => {
    let match;
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[1],
        fullMatch: match[0],
        format: pattern.format,
        type: pattern.type,
        url: match[2] || null // For links
      });
    }
  });
  
  // Sort matches by start position
  matches.sort((a, b) => a.start - b.start);
  
  // Remove overlapping matches (keep the first one)
  const validMatches = [];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const hasOverlap = validMatches.some(existing => 
      (current.start < existing.end && current.end > existing.start)
    );
    
    if (!hasOverlap) {
      validMatches.push(current);
    }
  }
  
  // Build rich text array
  let lastEnd = 0;
  
  validMatches.forEach(match => {
    // Add text before this match
    if (match.start > lastEnd) {
      const beforeText = text.substring(lastEnd, match.start);
      if (beforeText) {
        parts.push({
          type: "text",
          text: {
            content: beforeText
          }
        });
      }
    }
    
    // Add the formatted text
    if (match.type === 'link') {
      parts.push({
        type: "text",
        text: {
          content: match.content,
          link: {
            url: match.url
          }
        }
      });
    } else {
      parts.push({
        type: "text",
        text: {
          content: match.content
        },
        annotations: match.format
      });
    }
    
    lastEnd = match.end;
  });
  
  // Add remaining text
  if (lastEnd < text.length) {
    const remainingText = text.substring(lastEnd);
    if (remainingText) {
      parts.push({
        type: "text",
        text: {
          content: remainingText
        }
      });
    }
  }
  
  // If no formatting was found, return simple text
  if (parts.length === 0 && text.trim()) {
    parts.push({
      type: "text",
      text: {
        content: text
      }
    });
  }
  
  return parts;
}
