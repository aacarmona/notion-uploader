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
    
    // Crear el payload para la API de Notion
    const notionPayload = {
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
      },
      children: blocks
    };

    // Llamar a la API de Notion desde el servidor
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(notionPayload)
    });

    const responseData = await response.text();
    
    if (!response.ok) {
      console.error('Notion API Error:', response.status, responseData);
      return new Response(JSON.stringify({ 
        error: `Notion API Error: ${response.status} - ${responseData}` 
      }), {
        status: response.status,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const result = JSON.parse(responseData);
    
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

// Función para parsear Markdown con matemáticas
function parseMarkdownWithMath(markdownContent) {
  const blocks = [];
  const lines = markdownContent.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Handle math blocks ($$...$$)
    if (line.startsWith('$$')) {
      const mathContent = [];
      i++;
      while (i < lines.length && !lines[i].trim().endsWith('$$')) {
        mathContent.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        const lastLine = lines[i].replace('$$', '').trim();
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
          rich_text: processInlineMath(text)
        }
      });
    }
    // Handle regular paragraphs
    else if (line && !line.startsWith('$$')) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: processInlineMath(line)
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

function processInlineMath(text) {
  const richText = [];
  const parts = text.split(/\$([^$]+)\$/);

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) { // Regular text
      if (parts[i]) {
        richText.push({
          type: "text",
          text: {
            content: parts[i]
          }
        });
      }
    } else { // Math equation
      richText.push({
        type: "equation",
        equation: {
          expression: parts[i].trim()
        }
      });
    }
  }

  return richText;
}