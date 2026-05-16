import React, { useState, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedSafeAreaView';
import { useTheme } from '../theme/ThemeProvider';
import { LucideX, LucideHash } from 'lucide-react-native';
import { getAllUniqueTags } from '../services/database';

interface TagInputProps {
  tags: string[];
  onChangeTags: (tags: string[]) => void;
  placeholder?: string;
}

export const TagInput = ({ tags, onChangeTags, placeholder = "Add a tag..." }: TagInputProps) => {
  const { colors } = useTheme();
  const [inputText, setInputText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);

  useEffect(() => {
    getAllUniqueTags().then(setAllTags);
  }, []);

  useEffect(() => {
    if (inputText.trim().length > 0) {
      const q = inputText.trim().toLowerCase();
      setSuggestions(allTags.filter(t => t.toLowerCase().includes(q) && !tags.includes(t)));
    } else {
      setSuggestions(allTags.filter(t => !tags.includes(t)).slice(0, 10)); // show up to 10 suggestions
    }
  }, [inputText, allTags, tags]);

  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!t) return;
    if (tags.includes(t)) {
      setErrorMsg(`Topic #${t} is already added`);
      setTimeout(() => setErrorMsg(null), 2000);
      setInputText('');
      return;
    }
    onChangeTags([...tags, t]);
    setInputText('');
    setErrorMsg(null);
  };

  const removeTag = (tag: string) => {
    onChangeTags(tags.filter(t => t !== tag));
  };

  return (
    <View style={styles.container}>
      <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <LucideHash color={colors.secondary} size={16} />
        <TextInput
          style={[styles.input, { color: colors.primary }]}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={() => addTag(inputText)}
          blurOnSubmit={false}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {inputText.length > 0 && (
          <TouchableOpacity onPress={() => addTag(inputText)} style={[styles.addButton, { backgroundColor: colors.accent }]}>
            <ThemedText style={{ color: '#FFFFFF', fontSize: 12, fontWeight: 'bold' }}>Add</ThemedText>
          </TouchableOpacity>
        )}
      </View>

      {errorMsg && (
        <ThemedText style={{ color: colors.danger, fontSize: 11, marginTop: 6, marginLeft: 12 }}>
          {errorMsg}
        </ThemedText>
      )}

      {/* Selected Tags */}
      {tags.length > 0 && (
        <View style={styles.tagsContainer}>
          {tags.map(tag => (
            <View key={tag} style={[styles.tagPill, { backgroundColor: colors.translucent }]}>
              <ThemedText style={{ color: colors.primary, fontSize: 13, marginRight: 4 }}>#{tag}</ThemedText>
              <TouchableOpacity onPress={() => removeTag(tag)}>
                <LucideX color={colors.secondary} size={14} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestionsScroll}>
          {suggestions.map(sug => (
            <TouchableOpacity 
              key={sug} 
              onPress={() => addTag(sug)}
              style={[styles.suggestionPill, { borderColor: colors.border }]}
            >
              <LucideHash color={colors.secondary} size={12} />
              <ThemedText style={{ color: colors.secondary, fontSize: 12, marginLeft: 2 }}>{sug}</ThemedText>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
  },
  addButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    gap: 8,
  },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  suggestionsScroll: {
    marginTop: 12,
  },
  suggestionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    marginRight: 8,
  },
});
