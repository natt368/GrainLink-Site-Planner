import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { Project } from '../types';

// Initialize Firebase App and Auth
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive');

const TOKEN_KEY = 'gdrive_access_token_v1';
const EXPIRY_KEY = 'gdrive_access_token_expiry_v1';

const getStoredToken = (): string | null => {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const expiry = localStorage.getItem(EXPIRY_KEY);
    if (token && expiry) {
      if (Date.now() < parseInt(expiry, 10)) {
        return token;
      }
    }
  } catch (e) {
    console.error('Error reading localStorage token:', e);
  }
  // Clear if expired or invalid
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
  } catch (e) {}
  return null;
};

const storeToken = (token: string, expiryDurationMs: number = 55 * 60 * 1000) => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EXPIRY_KEY, (Date.now() + expiryDurationMs).toString());
  } catch (e) {
    console.error('Error saving token to localStorage:', e);
  }
};

const clearStoredToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
  } catch (e) {}
};

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const storedToken = getStoredToken();
      if (storedToken) {
        cachedAccessToken = storedToken;
        if (onAuthSuccess) onAuthSuccess(user, storedToken);
      } else if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      clearStoredToken();
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  // Check if we have an active user and a valid stored token
  const storedToken = getStoredToken();
  if (storedToken && auth.currentUser) {
    cachedAccessToken = storedToken;
    return { user: auth.currentUser, accessToken: storedToken };
  }

  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Google Auth');
    }

    cachedAccessToken = credential.accessToken;
    storeToken(cachedAccessToken);
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  clearStoredToken();
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken || getStoredToken();
};

/**
 * Gets or returns the connected Google Drive folder ID specified by the user
 */
export const getOrCreateFolder = async (accessToken: string): Promise<string> => {
  // Use the connected folder ID provided by the user
  return '1snSArcLLQakoFybxXejVNb5kvEDDOCmY';
};

/**
 * Saves or updates a project JSON file in the 'GrainLink Planner Designs' folder
 */
export const saveProjectToDrive = async (accessToken: string, project: Project): Promise<string> => {
  const folderId = await getOrCreateFolder(accessToken);
  const fileName = `${project.name}.json`;
  
  // Search for an existing file with the same name in this folder (including shared items and shared drives)
  const q = encodeURIComponent(`'${folderId}' in parents and name = '${fileName.replace(/'/g, "\\'")}' and mimeType = 'application/json' and trashed = false`);
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  
  if (searchRes.status === 401) {
    throw new Error('Google session expired (1 hour limit). Please click "Connect" again to quickly re-authorize your session.');
  }
  
  let fileId = '';
  let duplicateFileIds: string[] = [];
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      fileId = searchData.files[0].id;
      if (searchData.files.length > 1) {
        duplicateFileIds = searchData.files.slice(1).map((f: any) => f.id);
      }
    }
  }

  // Delete any additional duplicate files with the same name to keep the Drive folder perfectly clean
  if (duplicateFileIds.length > 0) {
    for (const dupId of duplicateFileIds) {
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${dupId}?supportsAllDrives=true`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch (err) {
        console.warn(`Failed to delete duplicate file ${dupId}:`, err);
      }
    }
  }
  
  if (fileId) {
    // Update existing file media (content) and optionally update name/metadata if needed
    // Simple media update endpoint: PATCH https://www.googleapis.com/upload/drive/v3/files/fileId?uploadType=media
    const updateMediaUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`;
    const updateRes = await fetch(updateMediaUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(project),
    });
    
    if (updateRes.status === 401) {
      throw new Error('Google session expired (1 hour limit). Please click "Connect" again to quickly re-authorize your session.');
    }
    
    if (!updateRes.ok) {
      const errorBody = await updateRes.text();
      if (errorBody.includes('404')) {
        throw new Error(`The design file "${fileName}" could not be updated. Please verify that your Google Account has Writer/Editor access to this file and its parent folder.`);
      }
      throw new Error(`Failed to update project file: ${updateRes.statusText} - ${errorBody}`);
    }
    
    return fileId;
  } else {
    // Create new file metadata first with parent folder
    const createMetaUrl = 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true';
    const createMetaRes = await fetch(createMetaUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: fileName,
        mimeType: 'application/json',
        parents: [folderId],
      }),
    });
    
    if (createMetaRes.status === 401) {
      throw new Error('Google session expired (1 hour limit). Please click "Connect" again to quickly re-authorize your session.');
    }
    
    if (!createMetaRes.ok) {
      const errorBody = await createMetaRes.text();
      if (errorBody.includes('404')) {
        throw new Error(`Google Drive folder "${folderId}" was not found or is not writable by your Google Account. 

To fix this:
1. Open the Google Drive folder link in your browser.
2. Ensure you are signed in with the same Google Account used in this app (${auth.currentUser?.email || 'your email'}).
3. Check that your account has "Editor" permissions on this folder. If it is owned by another user, they must share it with you as an Editor.`);
      }
      throw new Error(`Failed to create project file metadata: ${createMetaRes.statusText} - ${errorBody}`);
    }
    
    const fileMeta = await createMetaRes.json();
    fileId = fileMeta.id;
    
    // Upload content to the newly created file ID
    const uploadMediaUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`;
    const uploadRes = await fetch(uploadMediaUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(project),
    });
    
    if (uploadRes.status === 401) {
      throw new Error('Google session expired (1 hour limit). Please click "Connect" again to quickly re-authorize your session.');
    }
    
    if (!uploadRes.ok) {
      const errorBody = await uploadRes.text();
      throw new Error(`Failed to upload project contents: ${uploadRes.statusText} - ${errorBody}`);
    }
    
    return fileId;
  }
};

/**
 * Lists all project JSON files in the 'GrainLink Planner Designs' folder
 */
export const listProjectsFromDrive = async (accessToken: string): Promise<DriveFile[]> => {
  const folderId = await getOrCreateFolder(accessToken);
  const q = encodeURIComponent(`'${folderId}' in parents and mimeType = 'application/json' and trashed = false`);
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  
  const res = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  
  if (res.status === 401) {
    throw new Error('Google session expired (1 hour limit). Please click "Connect" again to quickly re-authorize your session.');
  }
  
  if (!res.ok) {
    const errorBody = await res.text();
    if (errorBody.includes('404')) {
      throw new Error(`The connected Google Drive folder "${folderId}" was not found or is not accessible. Please ensure your Google Account has access to this folder.`);
    }
    throw new Error(`Failed to list designs from Google Drive: ${res.statusText} - ${errorBody}`);
  }
  
  const data = await res.json();
  return data.files || [];
};

/**
 * Loads a project JSON file by its Google Drive file ID
 */
export const loadProjectFromDrive = async (accessToken: string, fileId: string): Promise<Project> => {
  const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  
  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  
  if (res.status === 401) {
    throw new Error('Google session expired (1 hour limit). Please click "Connect" again to quickly re-authorize your session.');
  }
  
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to download design file: ${res.statusText} - ${errorBody}`);
  }
  
  const project: Project = await res.json();
  return project;
};
